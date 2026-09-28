'use strict';

const { fetchUrl, isDseUrl, sleep } = require('../http/HttpTool');
const HtmlTool = require('../html/HtmlTool');
const config = require('../../config');
const logger = require('../../logging/logger');

const log = logger.createChild({ tool: 'dse' });

/**
 * DSE-specific tool.
 *
 * Provides high-level methods for interacting with the DSE website.
 * All URL construction happens here — no other module builds DSE URLs.
 *
 * Extraction strategies (layered, in priority order):
 *   1. __NEXT_DATA__ embedded JSON
 *   2. Direct HTML fetch + Cheerio parsing
 *   3. (Playwright — handled by BrowserTool, not here)
 */

/**
 * Build the canonical URL for a DSE company page.
 * @param {string} symbol - e.g. 'BATBC'
 * @returns {string}
 */
function buildCompanyUrl(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    throw new Error('Symbol must be a non-empty string');
  }
  const clean = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(clean)) {
    throw new Error(`Invalid DSE symbol: ${symbol}`);
  }
  return `${config.dse.baseUrl}/company/${clean}`;
}

/**
 * Fetch the company page HTML via a plain HTTP request.
 *
 * For a Next.js site this may return a minimal shell if JavaScript
 * renders the content. The caller must check isRenderedPage().
 *
 * @param {string} symbol
 * @returns {Promise<FetchResult>}
 *
 * @typedef {object} FetchResult
 * @property {string} symbol
 * @property {string} url
 * @property {number} statusCode
 * @property {string} html
 * @property {Date}   fetchedAt
 * @property {boolean} isRendered
 */
async function fetchCompanyPage(symbol) {
  const url = buildCompanyUrl(symbol);

  if (!isDseUrl(url)) {
    throw new Error(`Constructed URL is not a DSE URL: ${url}`);
  }

  log.info('Fetching DSE company page', { symbol, url });

  const result = await fetchUrl(url);

  if (result.statusCode === 404) {
    throw new Error(`DSE company page not found for symbol: ${symbol} (HTTP 404)`);
  }

  if (result.statusCode !== 200) {
    throw new Error(`Unexpected HTTP ${result.statusCode} for ${url}`);
  }

  const html = result.data;
  const isRendered = HtmlTool.isRenderedPage(html);

  log.debug('Page fetched', {
    symbol,
    statusCode: result.statusCode,
    htmlBytes: html.length,
    isRendered,
  });

  // Respectful delay
  await sleep(config.http.delayMs);

  return {
    symbol,
    url,
    statusCode: result.statusCode,
    html,
    fetchedAt: new Date(),
    isRendered,
  };
}

/**
 * Attempt to extract __NEXT_DATA__ from a fetched HTML string.
 *
 * This is the preferred strategy because it gives us structured server-side
 * props without needing to parse tables.
 *
 * @param {string} html
 * @returns {object|null}  Parsed __NEXT_DATA__ or null if not found
 */
function extractNextData(html) {
  const scripts = HtmlTool.extractJsonScripts(html);
  const nextData = scripts.find((s) => s.id === '__NEXT_DATA__');
  if (nextData) {
    log.debug('Found __NEXT_DATA__', { keys: Object.keys(nextData.data || {}) });
    return nextData.data;
  }
  return null;
}

/**
 * Extract the company data object from __NEXT_DATA__ if present.
 *
 * Next.js typically stores page props under:
 *   props.pageProps.<something>
 *
 * We try several known paths and return whichever has the most data.
 *
 * @param {object} nextData
 * @returns {object|null}
 */
function extractCompanyFromNextData(nextData) {
  if (!nextData) return null;

  const pageProps = nextData?.props?.pageProps;
  if (!pageProps) return null;

  // Try common prop key patterns
  const candidates = [
    pageProps.companyData,
    pageProps.company,
    pageProps.instrument,
    pageProps.data,
    pageProps.details,
    pageProps,
  ].filter(Boolean);

  // Return the richest object (most keys)
  let best = null;
  let bestKeys = 0;

  for (const c of candidates) {
    if (typeof c === 'object' && !Array.isArray(c)) {
      const keyCount = Object.keys(c).length;
      if (keyCount > bestKeys) {
        best = c;
        bestKeys = keyCount;
      }
    }
  }

  return best;
}

/**
 * Get company list page (for scrape:all).
 * @returns {Promise<FetchResult>}
 */
async function fetchCompanyListPage() {
  const url = `${config.dse.baseUrl}/listed-company`;
  log.info('Fetching DSE company list', { url });
  const result = await fetchUrl(url);
  await sleep(config.http.delayMs);
  return {
    url,
    statusCode: result.statusCode,
    html: result.data,
    fetchedAt: new Date(),
  };
}

module.exports = {
  buildCompanyUrl,
  fetchCompanyPage,
  extractNextData,
  extractCompanyFromNextData,
  fetchCompanyListPage,
};
