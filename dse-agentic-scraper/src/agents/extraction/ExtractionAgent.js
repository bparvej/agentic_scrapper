'use strict';

const nextjsDataStrategy = require('../../extraction/strategies/nextjsDataStrategy');
const htmlStrategy = require('../../extraction/strategies/htmlStrategy');
const playwrightStrategy = require('../../extraction/strategies/playwrightStrategy');
const { buildCompanyUrl } = require('../../tools/dse/DseTool');
const logger = require('../../logging/logger');

const log = logger.createChild({ agent: 'extraction' });

/**
 * Extraction Agent.
 *
 * Runs the appropriate extraction strategy based on the source discovery decision.
 * Falls through strategies in priority order if a strategy yields nothing.
 *
 * Strategy priority:
 *   1. nextjs_data  (most reliable)
 *   2. html         (rendered HTML tables)
 *   3. playwright   (headless browser — last resort)
 *
 * The LLM is NOT used here. Extraction is entirely deterministic.
 *
 * @param {import('../../workflow/state/ScrapingState')} state
 * @returns {Promise<import('../../workflow/state/ScrapingState')>}
 */
async function run(state) {
  const { symbol, source, extractionStrategy } = state;

  log.info('Starting extraction', {
    runId: state.runId,
    symbol,
    strategy: extractionStrategy,
  });

  const html = source?.html || '';
  const nextData = source?.nextData || null;
  let result = null;

  // --- Strategy 1: Next.js data ---
  if (extractionStrategy === 'nextjs_data' || (!result && nextData)) {
    log.debug('Trying nextjs_data strategy', { symbol });
    try {
      result = nextjsDataStrategy.extract(html, symbol);
      if (result) log.info('nextjs_data strategy succeeded', { symbol });
    } catch (err) {
      log.warn('nextjs_data strategy threw', { symbol, error: err.message });
    }
  }

  // --- Strategy 2: HTML ---
  if (!result && (extractionStrategy === 'html' || extractionStrategy === 'nextjs_data' || extractionStrategy === 'browser' || extractionStrategy === 'playwright')) {
    log.debug('Trying html strategy', { symbol });
    try {
      result = htmlStrategy.extract(html, symbol);
      if (result && result.success) {
         log.info('html strategy succeeded', { symbol });
      } else {
         result = null; // force fallthrough to playwright if html yielded no data
      }
    } catch (err) {
      log.warn('html strategy threw', { symbol, error: err.message });
      result = null;
    }
  }

  // --- Strategy 3: Playwright ---
  if (!result && (extractionStrategy === 'browser' || extractionStrategy === 'playwright')) {
    log.debug('Trying playwright strategy', { symbol });
    try {
      const url = buildCompanyUrl(symbol);
      result = await playwrightStrategy.extract(url, symbol, {
        waitNetworkIdle: true,
        waitMs: 3000,
      });
      if (result && result.success) {
        log.info('playwright strategy succeeded', { symbol });
      }
    } catch (err) {
      log.warn('playwright strategy threw', { symbol, error: err.message });
    }
  }

  if (!result || !result.success) {
    log.error('All extraction strategies failed', { symbol });
    return state
      .addError('extraction', 'All extraction strategies failed')
      .update({ status: 'recovering', rawData: null });
  }

  log.info('Extraction complete', {
    runId: state.runId,
    symbol,
    strategy: result.strategy,
    warnings: result.warnings?.length || 0,
    errors: result.errors?.length || 0,
  });

  return state.update({
    status: 'validating',
    extractionStrategy: result.strategy,
    rawData: result.data,
    normalizedData: result.data,
  });
}

module.exports = { run };
