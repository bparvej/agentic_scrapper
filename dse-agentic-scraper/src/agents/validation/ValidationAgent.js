'use strict';

const fs = require('fs');
const path = require('path');
const { NormalizedInstrumentSchema } = require('../../extraction/schemas/instrumentSchema');
const businessRules = require('../../validation/businessRules');
const logger = require('../../logging/logger');

const PROMPT_PATH = path.join(__dirname, '../prompts/validation.md');
const systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');

const log = logger.createChild({ agent: 'validation' });

/**
 * Validation Agent.
 *
 * Three layers of validation:
 *   1. Schema validation (Zod) — deterministic
 *   2. Business rules validation — deterministic
 *   3. Historical anomaly detection + LLM reasoning — LLM used for classification
 *
 * @param {import('../../workflow/state/ScrapingState')} state
 * @param {import('../../providers/llm/LLMProvider')} llm
 * @param {object} [previousData]  - Previous instrument data from DB (may be null)
 * @returns {Promise<import('../../workflow/state/ScrapingState')>}
 */
async function run(state, llm, previousData = null) {
  const { symbol, normalizedData } = state;

  log.info('Starting validation', { runId: state.runId, symbol });

  if (!normalizedData) {
    log.error('No normalised data to validate', { symbol });
    return state
      .addError('validation', 'No normalised data available for validation')
      .transition('recovering');
  }

  const schemaErrors = [];
  const businessErrors = [];
  const warnings = [];
  const anomalies = [];

  // --- Layer 1: Schema validation (Zod) ---
  const schemaResult = NormalizedInstrumentSchema.safeParse(normalizedData);
  if (!schemaResult.success) {
    const zodErrors = schemaResult.error.errors.map(
      (e) => `${e.path.join('.')}: ${e.message}`
    );
    schemaErrors.push(...zodErrors);
    log.warn('Schema validation failed', { symbol, errors: zodErrors });
  }

  // --- Layer 2: Business rules (deterministic) ---
  const { errors: bizErrors, warnings: bizWarnings } = businessRules.validate(normalizedData);
  businessErrors.push(...bizErrors);
  warnings.push(...bizWarnings);

  if (bizErrors.length > 0) {
    log.warn('Business rule violations', { symbol, errors: bizErrors });
  }

  // --- Layer 3: Historical anomaly detection ---
  const rawAnomalies = _detectAnomalies(normalizedData, previousData);

  if (rawAnomalies.length > 0) {
    log.info('Anomalies detected, asking LLM to classify', {
      symbol,
      count: rawAnomalies.length,
    });

    try {
      const { z } = require('zod');
      const LLMAnomalySchema = z.object({
        anomalies: z.array(z.object({
          field: z.string(),
          severity: z.enum(['normal', 'warning', 'critical']),
          message: z.string(),
        })).default([]),
        overallAssessment: z.enum(['safe', 'review', 'block']),
        reason: z.string(),
      });

      const llmResult = await llm.generateStructured(
        {
          system: systemPrompt,
          user: JSON.stringify({
            symbol,
            currentData: _safeSubset(normalizedData),
            previousData: previousData ? _safeSubset(previousData) : null,
            detectedAnomalies: rawAnomalies,
          }, null, 2),
          temperature: 0,
        },
        LLMAnomalySchema
      );

      anomalies.push(...llmResult.anomalies.map((a) => ({
        ...a,
        previousValue: rawAnomalies.find(r => r.field === a.field)?.previousValue,
        currentValue: rawAnomalies.find(r => r.field === a.field)?.currentValue,
        changePercent: rawAnomalies.find(r => r.field === a.field)?.changePercent,
      })));

      log.info('LLM anomaly classification', {
        symbol,
        overallAssessment: llmResult.overallAssessment,
        anomalyCount: anomalies.length,
      });

      // Critical anomalies block persistence
      const criticalAnomalies = anomalies.filter((a) => a.severity === 'critical');
      if (criticalAnomalies.length > 0) {
        businessErrors.push(
          ...criticalAnomalies.map((a) => `CRITICAL anomaly: ${a.field} — ${a.message}`)
        );
      }
    } catch (err) {
      log.warn('LLM anomaly classification failed, using conservative defaults', {
        error: err.message,
      });
      // Fallback: treat all anomalies as warnings
      anomalies.push(
        ...rawAnomalies.map((a) => ({
          ...a,
          severity: 'warning',
          message: a.message || `Unusual change in ${a.field}`,
        }))
      );
    }
  }

  const isValid = schemaErrors.length === 0 && businessErrors.length === 0;
  const hasCritical = anomalies.some((a) => a.severity === 'critical');

  const validationResult = {
    valid: isValid && !hasCritical,
    schemaErrors,
    businessErrors,
    warnings,
    anomalies,
  };

  log.info('Validation complete', {
    runId: state.runId,
    symbol,
    valid: validationResult.valid,
    schemaErrors: schemaErrors.length,
    businessErrors: businessErrors.length,
    warnings: warnings.length,
    anomalies: anomalies.length,
  });

  const nextStatus = validationResult.valid ? 'persisting' : 'recovering';

  return state.update({
    validationResult,
    anomalies,
    status: nextStatus,
  });
}

/**
 * Detect numeric anomalies by comparing current data to previous DB data.
 * Pure deterministic calculation — no LLM involved.
 */
function _detectAnomalies(current, previous) {
  if (!previous) return [];

  const anomalies = [];

  const numericFields = [
    'lastTradePrice', 'closePrice', 'eps', 'navps', 'marketCap',
    'paidUpCapital', 'peRatio', 'cashDividend', 'dividendYield',
  ];

  for (const field of numericFields) {
    const curr = current[field];
    const prev = previous[field];

    if (curr === null || curr === undefined) continue;
    if (prev === null || prev === undefined) continue;
    if (prev === 0) continue;

    const changePct = ((curr - prev) / Math.abs(prev)) * 100;

    // Flag if change > 50% for key financial metrics
    const thresholds = {
      lastTradePrice: 50,
      closePrice: 50,
      eps: 200,
      navps: 100,
      marketCap: 100,
      paidUpCapital: 50,
      peRatio: 300,
      cashDividend: 200,
      dividendYield: 200,
    };

    const threshold = thresholds[field] || 100;

    if (Math.abs(changePct) > threshold) {
      anomalies.push({
        field,
        previousValue: prev,
        currentValue: curr,
        changePercent: changePct,
        message: `${field} changed by ${changePct.toFixed(1)}% (${prev} → ${curr})`,
      });
    }
  }

  return anomalies;
}

/**
 * Return a safe subset of instrument data for LLM consumption.
 * Excludes large HTML blobs and extracted fields arrays.
 */
function _safeSubset(data) {
  const { extractedFields, metadata, ...rest } = data;
  return rest;
}

module.exports = { run };
