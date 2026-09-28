'use strict';

const { BrowserTool } = require('../../tools/browser/BrowserTool');
const htmlStrategy = require('./htmlStrategy');
const logger = require('../../logging/logger');

const log = logger.createChild({ strategy: 'playwright' });

/**
 * Strategy 3: Extract instrument data using Playwright headless browser.
 *
 * Used as a fallback when:
 *   - __NEXT_DATA__ is not present
 *   - Direct HTTP fetch returns an unrendered shell
 *
 * Playwright renders the full page including JavaScript, then we
 * pass the resulting HTML to htmlStrategy for parsing.
 *
 * This strategy is more expensive (spawns a browser) so it is only
 * used when cheaper strategies have failed.
 *
 * @param {string} url    - Full DSE company URL
 * @param {string} symbol
 * @param {object} [opts]
 * @param {boolean} [opts.waitNetworkIdle]
 * @param {string}  [opts.waitForSelector]   - CSS selector to wait for
 * @returns {Promise<ExtractionResult|null>}
 */
async function extract(url, symbol, opts = {}) {
  log.info('Starting Playwright extraction', { symbol, url });

  const browser = new BrowserTool();

  try {
    await browser.launch();

    const page = await browser.openPage(url, {
      waitNetworkIdle: opts.waitNetworkIdle ?? true,
      waitMs: opts.waitMs ?? 3000,
    });

    // Wait for a specific selector if requested (from recovery agent)
    if (opts.waitForSelector) {
      try {
        await page.waitFor(opts.waitForSelector, 8000);
        log.debug('Waited for selector', { selector: opts.waitForSelector });
      } catch {
        log.warn('Selector did not appear in time', { selector: opts.waitForSelector });
      }
    }

    const html = page.getHtml();
    log.debug('Playwright page content captured', { htmlBytes: html.length, isRendered: page.isRendered() });

    if (!page.isRendered()) {
      log.warn('Playwright page does not appear to be rendered', { symbol });
      return {
        success: false,
        strategy: 'playwright',
        data: null,
        warnings: ['Playwright page does not appear fully rendered'],
        errors: ['Page content insufficient after browser rendering'],
      };
    }

    // Pass rendered HTML to the HTML strategy
    const result = htmlStrategy.extract(html, symbol);

    if (result) {
      result.strategy = 'playwright';
      result.data.extractionStrategy = 'playwright';

      // Enrich with network requests (useful for future API discovery)
      const networkRequests = page.getNetworkRequests();
      if (networkRequests.length > 0) {
        result.data.metadata._networkRequests = networkRequests.slice(0, 20);
        log.debug('Captured network requests', { count: networkRequests.length });
      }
    }

    return result;
  } catch (err) {
    log.error('Playwright extraction failed', { symbol, error: err.message });
    return {
      success: false,
      strategy: 'playwright',
      data: null,
      warnings: [],
      errors: [`Playwright extraction failed: ${err.message}`],
    };
  } finally {
    await browser.close();
  }
}

module.exports = { extract };
