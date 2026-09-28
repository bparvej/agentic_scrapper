'use strict';

const fs = require('fs');
const path = require('path');
const { fetchCompanyPage, extractNextData } = require('../../tools/dse/DseTool');
const HtmlTool = require('../../tools/html/HtmlTool');
const { SourceDiscoveryOutputSchema } = require('../../extraction/schemas/instrumentSchema');
const logger = require('../../logging/logger');

const PROMPT_PATH = path.join(__dirname, '../prompts/source-discovery.md');
const systemPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');

const log = logger.createChild({ agent: 'source-discovery' });

/**
 * Source Discovery Agent.
 *
 * Responsibilities:
 *   1. Fetch the DSE company page via HTTP
 *   2. Determine whether __NEXT_DATA__ is present
 *   3. Determine whether the page is fully rendered
 *   4. Ask the LLM to confirm the best extraction strategy
 *
 * The LLM is used for reasoning about the source type.
 * The actual HTTP fetch is deterministic Node.js code.
 *
 * @param {import('../../workflow/state/ScrapingState')} state
 * @param {import('../../providers/llm/LLMProvider')} llm
 * @returns {Promise<import('../../workflow/state/ScrapingState')>}
 */
async function run(state, llm) {
  const { symbol } = state;
  log.info('Starting source discovery', { runId: state.runId, symbol });

  let fetchResult;
  try {
    fetchResult = await fetchCompanyPage(symbol);
  } catch (err) {
    log.error('Failed to fetch DSE page', { symbol, error: err.message });
    return state
      .addError('source-discovery', err)
      .transition('failed');
  }

  const html = fetchResult.html;

  // --- Deterministic analysis (no LLM) ---
  const nextData = extractNextData(html);
  const isRendered = fetchResult.isRendered;
  const bodyTextLength = HtmlTool.extractText(html).length;
  const tables = HtmlTool.extractTables(html);
  const jsonScripts = HtmlTool.extractJsonScripts(html);

  log.debug('Page analysis', {
    symbol,
    isRendered,
    bodyTextLength,
    tableCount: tables.length,
    hasNextData: !!nextData,
    jsonScriptCount: jsonScripts.length,
  });

  // Build evidence summary for LLM
  const evidenceSummary = {
    url: fetchResult.url,
    statusCode: fetchResult.statusCode,
    bodyTextLength,
    isRendered,
    tableCount: tables.length,
    hasNextData: !!nextData,
    nextDataKeys: nextData ? Object.keys(nextData?.props?.pageProps || {}).slice(0, 10) : [],
    jsonScriptCount: jsonScripts.length,
    sampleText: HtmlTool.extractText(html).slice(0, 300),
  };

  // --- LLM reasoning ---
  let sourceDecision;
  try {
    sourceDecision = await llm.generateStructured(
      {
        system: systemPrompt,
        user: `Analyse this DSE page fetch result and determine the extraction strategy:\n\n${JSON.stringify(evidenceSummary, null, 2)}`,
        temperature: 0,
      },
      SourceDiscoveryOutputSchema
    );
  } catch (err) {
    log.warn('LLM source discovery failed, applying deterministic fallback', { error: err.message });
    // Deterministic fallback — no LLM required
    sourceDecision = _deterministicFallback(evidenceSummary, nextData);
  }

  log.info('Source discovery decision', {
    runId: state.runId,
    symbol,
    sourceType: sourceDecision.sourceType,
    confidence: sourceDecision.confidence,
    reason: sourceDecision.reason,
  });

  return state.update({
    status: 'analyzing',
    url: fetchResult.url,
    source: {
      url: fetchResult.url,
      statusCode: fetchResult.statusCode,
      fetchedAt: fetchResult.fetchedAt,
      html,                          // kept in memory for next stages
      nextData,                       // kept for extraction
    },
    extractionStrategy: sourceDecision.sourceType,
    pageMetadata: {
      isRendered,
      bodyTextLength,
      tableCount: tables.length,
      hasNextData: !!nextData,
      sourceDecision,
    },
  });
}

/**
 * Deterministic fallback when LLM is unavailable.
 * Logic mirrors the LLM's reasoning rules.
 */
function _deterministicFallback(evidence, nextData) {
  if (nextData) {
    return {
      sourceType: 'nextjs_data',
      source: evidence.url,
      confidence: 0.90,
      reason: '__NEXT_DATA__ found',
      requiresBrowser: false,
      alternativeSources: [],
    };
  }

  if (evidence.isRendered && evidence.tableCount > 0) {
    return {
      sourceType: 'html',
      source: evidence.url,
      confidence: 0.80,
      reason: 'Page is rendered with tables',
      requiresBrowser: false,
      alternativeSources: [],
    };
  }

  return {
    sourceType: 'browser',
    source: evidence.url,
    confidence: 0.70,
    reason: 'Page appears to be a JS shell — browser rendering required',
    requiresBrowser: true,
    alternativeSources: [],
  };
}

module.exports = { run };
