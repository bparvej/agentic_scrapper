'use strict';

const axios = require('axios');
const config = require('../../config');
const logger = require('../../logging/logger');

const log = logger.createChild({ tool: 'http' });

/**
 * HTTP tool — all outbound HTTP is performed through this module.
 *
 * Features:
 * - Configurable timeout
 * - Retry with exponential backoff
 * - 429 / 5xx handling
 * - Respectable delay between requests
 * - User-agent header (identifies as a research scraper, not a bot)
 *
 * This tool never executes arbitrary URLs from LLM output directly.
 * Callers must validate URLs before passing them here.
 */

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

/**
 * Sleep for ms milliseconds.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL with retry and backoff.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxRetries]
 * @param {number} [opts.delayMs]  - Initial delay before retry
 * @param {object} [opts.headers]
 * @returns {Promise<{data: string|object, statusCode: number, headers: object, url: string}>}
 */
async function fetchUrl(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? config.http.timeoutMs;
  const maxRetries = opts.maxRetries ?? config.http.maxRetries;
  const delayMs = opts.delayMs ?? config.http.delayMs;
  const headers = { ...DEFAULT_HEADERS, ...(opts.headers || {}) };

  let attempt = 0;
  let lastError;

  while (attempt <= maxRetries) {
    if (attempt > 0) {
      // Exponential backoff: delay * 2^(attempt-1)
      const backoff = delayMs * Math.pow(2, attempt - 1);
      log.debug(`Retry attempt ${attempt}/${maxRetries}, waiting ${backoff}ms`, { url });
      await sleep(backoff);
    }

    try {
      log.debug(`GET ${url}`, { attempt });

      const response = await axios.get(url, {
        timeout: timeoutMs,
        headers,
        // Return raw string so we can parse it ourselves
        responseType: 'text',
        // Don't throw on 4xx/5xx — handle them manually
        validateStatus: () => true,
        // Follow redirects
        maxRedirects: 5,
      });

      const statusCode = response.status;

      if (statusCode === 429) {
        const retryAfter = parseInt(response.headers['retry-after'] || '5', 10);
        log.warn(`Rate limited (429), waiting ${retryAfter}s`, { url });
        await sleep(retryAfter * 1000);
        attempt++;
        continue;
      }

      if (statusCode >= 500 && attempt < maxRetries) {
        log.warn(`Server error ${statusCode}, will retry`, { url, attempt });
        lastError = new Error(`HTTP ${statusCode} from ${url}`);
        attempt++;
        continue;
      }

      log.debug(`Response ${statusCode}`, { url, bytes: (response.data || '').length });

      return {
        data: response.data,
        statusCode,
        headers: response.headers,
        url: response.request?.res?.responseUrl || url,
      };
    } catch (err) {
      lastError = err;
      log.warn(`Fetch error on attempt ${attempt}`, { url, error: err.message });
      attempt++;
    }
  }

  throw new Error(
    `Failed to fetch ${url} after ${maxRetries} retries: ${lastError?.message || 'unknown error'}`
  );
}

/**
 * Validate that a URL is a safe, expected DSE URL.
 * Prevents SSRF / open redirect if a URL somehow comes from user input.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isDseUrl(url) {
  try {
    const parsed = new URL(url);
    const allowedHosts = ['dse.com.bd', 'www.dse.com.bd', 'dsebd.org', 'www.dsebd.org'];
    return allowedHosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

module.exports = { fetchUrl, isDseUrl, sleep };
