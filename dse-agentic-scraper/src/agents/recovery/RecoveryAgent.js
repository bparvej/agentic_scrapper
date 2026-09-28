'use strict';

const fs = require('fs');
const path = require('path');
const { RecoveryPlanSchema } = require('../../extraction/schemas/instrumentSchema');
const nextjsDataStrategy = require('../../extraction/strategies/nextjsDataStrategy');
const htmlStrategy = require('../../extraction/strategies/htmlStrategy');
const playwrightStrategy = require('../../extraction/strategies/playwrightStrategy');
const { fetchCompanyPage, buildCompanyUrl } = require('../../tools/dse/DseTool');
const config = require('../../config');
const logger = require('../../logging/logger');

const PROMPT_PATH = path.join(__dirname, '../prompts/recovery.md');
const systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');

const log = logger.createChild({ agent: 'recovery' });

/**
 * Recovery Agent.
 *
 * Called when extraction or validation fails.
 *
 * Flow:
 *   1. LLM diagnoses the failure and produces a recovery plan
 *   2. Recovery plan is executed deterministically
 *   3. If successful, returns updated state ready for re-validation
 *   4. If max attempts reached, marks state as failed
 *
 * @param {import('../../workflow/state/ScrapingState')} state
 * @param {import('../../providers/llm/LLMProvider')} llm
 * @returns {Promise<import('../../workflow/state/ScrapingState')>}
 */
async function run(state, llm) {
  const { symbol, recoveryAttempts, errors, extractionStrategy } = state;

  log.info('Starting recovery', {
    runId: state.runId,
    symbol,
    attempt: recoveryAttempts + 1,
    maxAttempts: config.workflow.maxRecoveryAttempts,
  });

  if (recoveryAttempts >= config.workflow.maxRecoveryAttempts) {
    log.error('Max recovery attempts reached', { symbol, attempts: recoveryAttempts });
    return state.addError('recovery', 'Max recovery attempts reached').transition('failed');
  }

  // Build context for LLM diagnosis
  const context = {
    symbol,
    url: state.url,
    currentStrategy: extractionStrategy,
    previousStrategiesTried: state.recoveryPlans.map((p) => p.strategy),
    errors: errors.slice(-3).map((e) => e.message),
    validationErrors: state.validationResult
      ? [
          ...state.validationResult.schemaErrors.slice(0, 5),
          ...state.validationResult.businessErrors.slice(0, 5),
        ]
      : [],
    pageInfo: {
      isRendered: state.pageMetadata?.isRendered,
      bodyTextLength: state.pageMetadata?.bodyTextLength,
      tableCount: state.pageMetadata?.tableCount,
      hasNextData: state.pageMetadata?.hasNextData,
    },
  };

  // --- LLM recovery planning ---
  let recoveryPlan;
  try {
    recoveryPlan = await llm.generateStructured(
      {
        system: systemPrompt,
        user: `Diagnose this extraction failure and produce a recovery plan:\n\n${JSON.stringify(context, null, 2)}`,
        temperature: 0,
      },
      RecoveryPlanSchema
    );
  } catch (err) {
    log.warn('LLM recovery planning failed, using deterministic fallback', { error: err.message });
    recoveryPlan = _deterministicRecoveryPlan(context);
  }

  log.info('Recovery plan', {
    runId: state.runId,
    symbol,
    strategy: recoveryPlan.strategy,
    reason: recoveryPlan.reason,
  });

  // Guard: don't retry a strategy that already failed
  if (state.recoveryPlans.map((p) => p.strategy).includes(recoveryPlan.strategy)) {
    log.warn('Recovery plan suggests already-tried strategy, escalating to playwright', { symbol });
    recoveryPlan = { ...recoveryPlan, strategy: 'playwright' };
  }

  // --- Execute recovery plan ---
  const newState = state.update({
    recoveryAttempts: recoveryAttempts + 1,
    recoveryPlans: [...state.recoveryPlans, recoveryPlan],
  });

  let result = null;

  try {
    switch (recoveryPlan.strategy) {
      case 'nextjs_data': {
        const html = state.source?.html || '';
        result = nextjsDataStrategy.extract(html, symbol);
        break;
      }

      case 'html': {
        // Re-fetch in case page changed, or use cached HTML
        let html = state.source?.html || '';
        if (!html || html.length < 500) {
          const fetchResult = await fetchCompanyPage(symbol);
          html = fetchResult.html;
        }
        result = htmlStrategy.extract(html, symbol);
        break;
      }

      case 'playwright': {
        const url = recoveryPlan.alternativeUrl || buildCompanyUrl(symbol);
        result = await playwrightStrategy.extract(url, symbol, {
          waitNetworkIdle: true,
          waitMs: recoveryPlan.actions?.includes('wait_for_network_idle') ? 5000 : 3000,
          waitForSelector: recoveryPlan.waitForSelector,
        });
        break;
      }

      case 'alternative_url': {
        const altUrl = recoveryPlan.alternativeUrl || buildCompanyUrl(symbol);
        result = await playwrightStrategy.extract(altUrl, symbol, {
          waitNetworkIdle: true,
          waitMs: 3000,
        });
        break;
      }

      default:
        log.warn('Unknown recovery strategy', { strategy: recoveryPlan.strategy });
    }
  } catch (err) {
    log.error('Recovery execution failed', { symbol, error: err.message });
    return newState.addError('recovery', err).transition('recovering');
  }

  if (!result || !result.success) {
    log.warn('Recovery strategy did not produce usable data', { symbol });
    return newState
      .addError('recovery', `Strategy ${recoveryPlan.strategy} yielded no data`)
      .transition('recovering');
  }

  log.info('Recovery succeeded', {
    runId: state.runId,
    symbol,
    strategy: result.strategy,
  });

  return newState.update({
    status: 'validating',
    extractionStrategy: result.strategy,
    rawData: result.data,
    normalizedData: result.data,
    validationResult: null,   // reset validation for re-run
  });
}

/**
 * Deterministic recovery fallback when LLM is unavailable.
 */
function _deterministicRecoveryPlan(context) {
  const tried = new Set(context.previousStrategiesTried || []);
  const isShell = context.pageInfo?.bodyTextLength < 300;

  if (isShell && !tried.has('playwright')) {
    return {
      strategy: 'playwright',
      reason: 'Page is a JS shell, browser rendering needed',
      actions: ['wait_for_network_idle', 'extract_tables'],
      confidence: 0.8,
    };
  }

  if (!tried.has('html')) {
    return {
      strategy: 'html',
      reason: 'Try HTML extraction',
      actions: ['extract_tables'],
      confidence: 0.6,
    };
  }

  return {
    strategy: 'playwright',
    reason: 'Fallback to browser',
    actions: ['wait_for_network_idle', 'extract_tables'],
    confidence: 0.5,
  };
}

module.exports = { run };
