'use strict';

const config = require('../../config');
const logger = require('../../logging/logger');
const HtmlTool = require('../html/HtmlTool');

const log = logger.createChild({ tool: 'browser' });

/**
 * Browser Tool — Playwright-based headless browser abstraction.
 *
 * Only instantiated when HTTP + HTML strategies fail.
 * Playwright is isolated here; no other module imports Playwright directly.
 *
 * Usage:
 *   const browser = new BrowserTool();
 *   await browser.launch();
 *   const result = await browser.openPage('https://dse.com.bd/company/BATBC');
 *   const tables = result.getTables();
 *   await browser.close();
 */
class BrowserTool {
  constructor() {
    this._browser = null;
    this._page = null;
    this._html = null;
    this._networkRequests = [];
  }

  /**
   * Launch the browser.
   * @param {object} [opts]
   * @param {boolean} [opts.headless]
   */
  async launch(opts = {}) {
    if (config.playwright.disabled) {
      throw new Error('Playwright is disabled via DISABLE_PLAYWRIGHT=true');
    }

    const { chromium } = require('playwright');
    const headless = opts.headless ?? config.playwright.headless;

    // Extra stability flags for running Chromium in a restrictive Docker environment
    const args = [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--disable-software-rasterizer'
    ];

    const launchOptions = { headless, args };

    log.info('Launching browser', { headless });
    this._browser = await chromium.launch(launchOptions);
  }

  /**
   * Open a page and wait for it to fully render.
   *
   * @param {string} url
   * @param {object} [opts]
   * @param {number} [opts.waitMs]        - Extra wait after load (ms)
   * @param {boolean} [opts.waitNetworkIdle] - Wait for network idle
   * @returns {Promise<BrowserPage>}
   */
  async openPage(url, opts = {}) {
    if (!this._browser) {
      await this.launch();
    }

    this._networkRequests = [];
    const context = await this._browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    this._page = page;

    // Capture network requests for API discovery
    page.on('request', (req) => {
      if (req.resourceType() === 'fetch' || req.resourceType() === 'xhr') {
        this._networkRequests.push({
          url: req.url(),
          method: req.method(),
          resourceType: req.resourceType(),
        });
      }
    });

    log.info('Opening page', { url });

    try {
      await page.goto(url, {
        timeout: config.http.timeoutMs,
        waitUntil: opts.waitNetworkIdle ? 'networkidle' : 'domcontentloaded',
      });

      // Additional wait for JS-rendered content
      if (opts.waitMs) {
        await page.waitForTimeout(opts.waitMs);
      } else {
        // Default: wait 2s for React/Next.js hydration
        await page.waitForTimeout(2000);
      }

      this._html = await page.content();

      log.debug('Page loaded', { url, htmlBytes: this._html.length });

      return new BrowserPage(this._html, this._networkRequests, page);
    } catch (err) {
      log.error('Failed to open page', { url, error: err.message });
      throw err;
    }
  }

  /**
   * Close the browser and release resources.
   */
  async close() {
    if (this._browser) {
      await this._browser.close();
      this._browser = null;
      this._page = null;
      log.debug('Browser closed');
    }
  }
}

/**
 * Wraps a loaded Playwright page with structured extraction methods.
 * These methods use HtmlTool internally — keeping extraction logic in one place.
 */
class BrowserPage {
  /**
   * @param {string} html
   * @param {Array} networkRequests
   * @param {import('playwright').Page} page
   */
  constructor(html, networkRequests, page) {
    this._html = html;
    this._networkRequests = networkRequests;
    this._page = page;
  }

  getHtml() {
    return this._html;
  }

  getText() {
    return HtmlTool.extractText(this._html);
  }

  getTables() {
    return HtmlTool.extractTables(this._html);
  }

  getKeyValuePairs() {
    return HtmlTool.extractKeyValuePairs(this._html);
  }

  getJsonScripts() {
    return HtmlTool.extractJsonScripts(this._html);
  }

  getLinks(baseUrl) {
    return HtmlTool.extractLinks(this._html, baseUrl);
  }

  getMetadata() {
    return HtmlTool.extractMetadata(this._html);
  }

  getNetworkRequests() {
    return this._networkRequests;
  }

  isRendered() {
    return HtmlTool.isRenderedPage(this._html);
  }

  /**
   * Click an element and wait for the page to update.
   * @param {string} selector
   */
  async click(selector) {
    await this._page.click(selector);
    await this._page.waitForTimeout(1000);
    this._html = await this._page.content();
  }

  /**
   * Wait for a CSS selector to appear.
   * @param {string} selector
   * @param {number} [timeout]
   */
  async waitFor(selector, timeout = 10000) {
    await this._page.waitForSelector(selector, { timeout });
    this._html = await this._page.content();
  }
}

module.exports = { BrowserTool, BrowserPage };
