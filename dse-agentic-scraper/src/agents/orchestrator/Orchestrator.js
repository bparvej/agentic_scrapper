'use strict';

const ScrapingState = require('../../workflow/state/ScrapingState');
const SourceDiscoveryAgent = require('../source-discovery/SourceDiscoveryAgent');
const ExtractionAgent = require('../extraction/ExtractionAgent');
const ValidationAgent = require('../validation/ValidationAgent');
const RecoveryAgent = require('../recovery/RecoveryAgent');
const PersistenceAgent = require('../persistence/PersistenceAgent');
const ScrapingRunRepository = require('../../repositories/ScrapingRunRepository');
const InstrumentRepository = require('../../repositories/InstrumentRepository');
const MarketDataRepository = require('../../repositories/MarketDataRepository');
const FinancialDataRepository = require('../../repositories/FinancialDataRepository');
const { getLLMProvider } = require('../../providers/llm/factory');
const config = require('../../config');
const logger = require('../../logging/logger');

const log = logger.createChild({ agent: 'orchestrator' });

/**
 * Orchestrator — master workflow controller.
 *
 * Drives the scraping state machine:
 *
 *   pending
 *     → fetching       (SourceDiscoveryAgent)
 *     → analyzing      (inside SourceDiscovery)
 *     → extracting     (ExtractionAgent)
 *     → validating     (ValidationAgent)
 *     → [recovering]   (RecoveryAgent — loops back to validating)
 *     → persisting     (PersistenceAgent)
 *     → completed
 *     → failed
 *
 * The orchestrator coordinates agents but does not contain business logic.
 *
 * @param {string} symbol
 * @param {object} [opts]
 * @param {boolean} [opts.force]     - Bypass duplicate detection
 * @param {boolean} [opts.noBrowser] - Disable Playwright strategy
 * @param {boolean} [opts.debug]     - Enable debug logging
 * @returns {Promise<ScrapingRunResult>}
 *
 * @typedef {object} ScrapingRunResult
 * @property {string}  runId
 * @property {string}  symbol
 * @property {string}  status
 * @property {number}  recordsCreated
 * @property {number}  recordsUpdated
 * @property {string[]} warnings
 * @property {string[]} errors
 * @property {number}  recoveryAttempts
 * @property {number}  durationMs
 */
async function scrape(symbol, opts = {}) {
  if (opts.debug) {
    process.env.LOG_LEVEL = 'debug';
  }

  const llm = getLLMProvider();
  let state = new ScrapingState({ symbol });

  log.info('=== Scraping run started ===', {
    runId: state.runId,
    symbol,
    llmProvider: llm.name,
  });

  // Persist the run record immediately so it is visible in the DB
  try {
    await ScrapingRunRepository.create(state);
  } catch (dbErr) {
    log.error('Failed to create scraping run record', { error: dbErr.message });
    // Non-fatal — continue without DB tracking
  }

  // ----------------------------------------------------------------
  // Step 1: Source Discovery (fetching + analyzing)
  // ----------------------------------------------------------------
  state = state.transition('fetching');
  await _updateRun(state);

  state = await SourceDiscoveryAgent.run(state, llm);
  await _updateRun(state);

  if (state.status === 'failed') {
    return _buildResult(state);
  }

  // ----------------------------------------------------------------
  // Step 2: Extraction
  // ----------------------------------------------------------------
  state = state.transition('extracting');
  await _updateRun(state);

  state = await ExtractionAgent.run(state);
  await _updateRun(state);

  // ----------------------------------------------------------------
  // Step 3: Validation → Recovery loop
  // ----------------------------------------------------------------
  const maxRecovery = config.workflow.maxRecoveryAttempts;
  let loopGuard = 0;

  while (
    (state.status === 'validating' || state.status === 'recovering') &&
    loopGuard <= maxRecovery + 1
  ) {
    loopGuard++;

    if (state.status === 'validating') {
      // Fetch previous data for anomaly comparison
      let previousData = null;
      try {
        const prev = await MarketDataRepository.findLatestBySymbol(symbol);
        const prevFin = await FinancialDataRepository.findLatestBySymbol(symbol);
        if (prev || prevFin) {
          previousData = { ...(prev || {}), ...(prevFin || {}) };
        }
      } catch (e) {
        log.warn('Could not load previous data for comparison', { error: e.message });
      }

      state = await ValidationAgent.run(state, llm, previousData);
      await _updateRun(state);
    }

    if (state.status === 'recovering') {
      if (state.recoveryAttempts >= maxRecovery) {
        log.error('Max recovery attempts exceeded', { symbol, attempts: state.recoveryAttempts });
        state = state.addError('orchestrator', 'Max recovery attempts exceeded').transition('failed');
        break;
      }
      state = await RecoveryAgent.run(state, llm);
      await _updateRun(state);
    }
  }

  if (state.status === 'failed') {
    await _finalise(state);
    return _buildResult(state);
  }

  // ----------------------------------------------------------------
  // Step 4: Persistence
  // ----------------------------------------------------------------
  state = state.transition('persisting');
  await _updateRun(state);

  state = await PersistenceAgent.run(state);
  await _updateRun(state);

  // ----------------------------------------------------------------
  // Finalise
  // ----------------------------------------------------------------
  await _finalise(state);

  log.info('=== Scraping run complete ===', {
    runId: state.runId,
    symbol,
    status: state.status,
    durationMs: state.durationMs,
  });

  return _buildResult(state);
}

async function _updateRun(state) {
  try {
    await ScrapingRunRepository.update(state);
  } catch (e) {
    log.warn('Failed to update run record', { error: e.message });
  }
}

async function _finalise(state) {
  // Log all errors to scraping_errors table
  if (state.errors?.length > 0) {
    try {
      await ScrapingRunRepository.logErrors(state.runId, state.errors);
    } catch (e) {
      log.warn('Failed to log errors', { error: e.message });
    }
  }
}

function _buildResult(state) {
  return {
    runId: state.runId,
    symbol: state.symbol,
    status: state.status,
    recordsCreated: state.persistenceResult?.recordsCreated || 0,
    recordsUpdated: state.persistenceResult?.recordsUpdated || 0,
    warnings: state.validationResult?.warnings || [],
    errors: state.errors.map((e) => e.message),
    recoveryAttempts: state.recoveryAttempts,
    durationMs: state.durationMs || 0,
    extractionStrategy: state.extractionStrategy,
    data: state.normalizedData || null,
  };
}

module.exports = { scrape };
