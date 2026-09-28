'use strict';

const InstrumentRepository = require('../../repositories/InstrumentRepository');
const MarketDataRepository = require('../../repositories/MarketDataRepository');
const FinancialDataRepository = require('../../repositories/FinancialDataRepository');
const ListingDataRepository = require('../../repositories/ListingDataRepository');
const ScrapingRunRepository = require('../../repositories/ScrapingRunRepository');
const { getDb } = require('../../database/knex');
const logger = require('../../logging/logger');

const log = logger.createChild({ agent: 'persistence' });

/**
 * Persistence Agent.
 *
 * Receives validated instrument data and persists it to the database.
 * All operations run inside a transaction for atomicity.
 *
 * The LLM is NEVER called here.
 * No raw SQL is generated from LLM output.
 * All DB operations go through typed repository methods.
 *
 * Only data that passed validation reaches this agent.
 *
 * @param {import('../../workflow/state/ScrapingState')} state
 * @returns {Promise<import('../../workflow/state/ScrapingState')>}
 */
async function run(state) {
  const { symbol, normalizedData, runId, validationResult } = state;

  // Guard — should never be reached without passing validation
  if (!validationResult?.valid) {
    log.error('Attempt to persist unvalidated data blocked', { symbol, runId });
    return state.addError('persistence', 'Persistence blocked: data failed validation').transition('failed');
  }

  log.info('Starting persistence', { runId, symbol });

  const db = getDb();
  let recordsCreated = 0;
  let recordsUpdated = 0;

  try {
    await db.transaction(async (trx) => {
      // Override getDb to use transaction connection
      // (Knex repos call getDb() so we pass trx context through a local override)

      // 1. Upsert instrument master record
      const { id: instrumentId, created: instCreated } =
        await InstrumentRepository.upsertTrx(trx, normalizedData);

      if (instCreated) recordsCreated++;
      else recordsUpdated++;

      // 2. Upsert market data
      const { created: mktCreated } = await MarketDataRepository.upsertTrx(
        trx, instrumentId, normalizedData, runId
      );
      if (mktCreated) recordsCreated++;
      else recordsUpdated++;

      // 3. Upsert financial data
      const { created: finCreated } = await FinancialDataRepository.upsertTrx(
        trx, instrumentId, normalizedData, runId
      );
      if (finCreated) recordsCreated++;
      else recordsUpdated++;

      // 4. Upsert listing / ownership data
      const { created: listCreated } = await ListingDataRepository.upsertTrx(
        trx, instrumentId, normalizedData, runId
      );
      if (listCreated) recordsCreated++;
      else recordsUpdated++;

      log.debug('Transaction complete', { symbol, recordsCreated, recordsUpdated });
    });

    // 5. Save raw snapshot outside transaction (non-critical)
    try {
      if (state.source?.html) {
        await ScrapingRunRepository.saveSnapshot(
          runId,
          symbol,
          state.url,
          state.extractionStrategy,
          state.source.html
        );
      }
    } catch (snapErr) {
      log.warn('Failed to save snapshot (non-critical)', { error: snapErr.message });
    }

    // 6. Log anomalies
    if (state.anomalies?.length > 0) {
      await ScrapingRunRepository.logAnomalies(runId, symbol, state.anomalies);
    }

    log.info('Persistence complete', { runId, symbol, recordsCreated, recordsUpdated });

    return state.update({
      status: 'completed',
      completedAt: new Date(),
      persistenceResult: {
        recordsCreated,
        recordsUpdated,
      },
    });
  } catch (err) {
    log.error('Persistence failed', { runId, symbol, error: err.message });
    return state.addError('persistence', err).transition('failed');
  }
}

module.exports = { run };
