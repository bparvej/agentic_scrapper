'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/knex');
const logger = require('../logging/logger');

const log = logger.createChild({ repository: 'scraping-run' });

/**
 * ScrapingRunRepository — CRUD for scraping_runs, scraping_errors,
 * scraping_anomalies, and scraping_snapshots.
 */

/**
 * Create a new scraping run record.
 * @param {import('../workflow/state/ScrapingState')} state
 * @returns {Promise<void>}
 */
async function create(state) {
  const db = getDb();
  const id = uuidv4();

  await db('scraping_runs').insert({
    id,
    run_id: state.runId,
    symbol: state.symbol,
    url: state.url,
    status: state.status,
    started_at: state.startedAt,
    created_at: new Date(),
    updated_at: new Date(),
  });

  log.debug('Scraping run created', { runId: state.runId });
}

/**
 * Update an existing scraping run record.
 * @param {import('../workflow/state/ScrapingState')} state
 * @returns {Promise<void>}
 */
async function update(state) {
  const db = getDb();

  await db('scraping_runs')
    .where({ run_id: state.runId })
    .update({
      status: state.status,
      url: state.url,
      extraction_strategy: state.extractionStrategy,
      recovery_attempts: state.recoveryAttempts,
      records_created: state.persistenceResult?.recordsCreated || 0,
      records_updated: state.persistenceResult?.recordsUpdated || 0,
      validation_passed: state.validationResult?.valid || false,
      warnings: JSON.stringify(state.validationResult?.warnings || []),
      errors: JSON.stringify(state.errors || []),
      completed_at: state.completedAt,
      updated_at: new Date(),
    });

  log.debug('Scraping run updated', { runId: state.runId, status: state.status });
}

/**
 * Log errors from workflow state.
 * @param {string} runId
 * @param {Array} errors
 */
async function logErrors(runId, errors) {
  const db = getDb();

  for (const err of errors) {
    await db('scraping_errors').insert({
      id: uuidv4(),
      scraping_run_id: runId,
      agent: err.agent,
      message: err.message,
      stack: err.stack || null,
      occurred_at: err.timestamp ? new Date(err.timestamp) : new Date(),
    });
  }
}

/**
 * Log anomalies.
 * @param {string} runId
 * @param {string} symbol
 * @param {Array} anomalies
 */
async function logAnomalies(runId, symbol, anomalies) {
  const db = getDb();

  for (const a of anomalies) {
    await db('scraping_anomalies').insert({
      id: uuidv4(),
      scraping_run_id: runId,
      symbol,
      field: a.field,
      severity: a.severity,
      message: a.message,
      previous_value: a.previousValue != null ? a.previousValue : null,
      current_value: a.currentValue != null ? a.currentValue : null,
      change_percent: a.changePercent != null ? a.changePercent : null,
      detected_at: new Date(),
    });
  }
}

/**
 * Save a raw HTML/JSON snapshot for debugging.
 * @param {string} runId
 * @param {string} symbol
 * @param {string} sourceUrl
 * @param {string} sourceType
 * @param {string} rawPayload  - HTML or JSON string (truncated if too large)
 */
async function saveSnapshot(runId, symbol, sourceUrl, sourceType, rawPayload) {
  const db = getDb();

  // Limit snapshot size to 1MB
  const MAX_BYTES = 1_000_000;
  const payload =
    rawPayload && rawPayload.length > MAX_BYTES
      ? rawPayload.slice(0, MAX_BYTES) + '... [TRUNCATED]'
      : rawPayload;

  await db('scraping_snapshots').insert({
    id: uuidv4(),
    scraping_run_id: runId,
    symbol,
    source_url: sourceUrl,
    source_type: sourceType,
    raw_payload: payload,
    created_at: new Date(),
  });

  log.debug('Snapshot saved', { runId, symbol, sourceType, bytes: payload?.length });
}

/**
 * Find a run by its runId.
 * @param {string} runId
 * @returns {Promise<object|null>}
 */
async function findByRunId(runId) {
  const db = getDb();
  return db('scraping_runs').where({ run_id: runId }).first() || null;
}

/**
 * Find recent runs for a symbol.
 * @param {string} symbol
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function findRecentBySymbol(symbol, limit = 10) {
  const db = getDb();
  return db('scraping_runs')
    .where({ symbol: symbol.toUpperCase() })
    .orderBy('started_at', 'desc')
    .limit(limit);
}

/**
 * Purge old snapshots beyond retention period.
 * @param {number} retentionDays
 */
async function purgeOldSnapshots(retentionDays) {
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const deleted = await db('scraping_snapshots')
    .where('created_at', '<', cutoff)
    .delete();

  log.info('Purged old snapshots', { deleted, cutoffDate: cutoff.toISOString() });
  return deleted;
}

module.exports = {
  create,
  update,
  logErrors,
  logAnomalies,
  saveSnapshot,
  findByRunId,
  findRecentBySymbol,
  purgeOldSnapshots,
};
