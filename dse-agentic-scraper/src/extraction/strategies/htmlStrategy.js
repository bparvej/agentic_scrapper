'use strict';

const HtmlTool = require('../../tools/html/HtmlTool');
const {
  normalizeNumber,
  normalizeString,
  normalizeDate,
  normalizePercentage,
  normalizeInteger,
} = require('../normalizers/valueNormalizer');
const logger = require('../../logging/logger');

const log = logger.createChild({ strategy: 'html' });

/**
 * Strategy 2: Extract instrument data from rendered HTML tables.
 *
 * This handles the DSE company page as rendered HTML (either from a
 * direct fetch that returned content, or from Playwright's page.content()).
 *
 * The DSE company page organises data in <table> elements with
 * label | value rows. We extract all tables, flatten them into
 * key-value pairs, and then map known labels to our schema.
 *
 * Because DSE may reorganise labels between versions, the mapping
 * is done by fuzzy label matching — not hard-coded positional selectors.
 *
 * @param {string} html  - Rendered HTML
 * @param {string} symbol
 * @returns {ExtractionResult|null}
 */
function extract(html, symbol) {
  log.debug('Attempting HTML table extraction', { symbol });

  if (!HtmlTool.isRenderedPage(html)) {
    log.debug('Page does not appear to be rendered', { symbol });
    return null;
  }

  // Step 1: Extract all tables
  const tables = HtmlTool.extractTables(html);
  log.debug('Tables found', { symbol, count: tables.length });

  // Step 2: Extract key-value pairs from all patterns
  const kvPairs = HtmlTool.extractKeyValuePairs(html);
  log.debug('Key-value pairs found', { symbol, count: Object.keys(kvPairs).length });

  // Step 3: Flatten all tables into a single key-value map
  const tableKv = {};
  for (const table of tables) {
    // Two-column tables are label→value tables
    if (table.headers.length === 2) {
      for (const row of table.rows) {
        const keys = Object.keys(row);
        if (keys.length === 2) {
          tableKv[row[keys[0]]] = row[keys[1]];
        }
      }
    }
    // Also check rows with exactly 2 cells
    for (const row of table.rows) {
      if (row.cells && row.cells.length === 2) {
        tableKv[row.cells[0]] = row.cells[1];
      }
    }
  }

  // Merge all sources into one flat map (kvPairs take priority)
  const allKv = { ...tableKv, ...kvPairs };
  log.debug('Total key-value pairs after merge', { symbol, count: Object.keys(allKv).length });

  if (Object.keys(allKv).length === 0) {
    log.warn('No key-value data found in HTML', { symbol });
    return null;
  }

  return _mapKvToSchema(allKv, symbol, tables);
}

/**
 * Map extracted key-value pairs to the normalised instrument schema.
 *
 * Uses fuzzy/case-insensitive label matching to survive minor label changes.
 */
function _mapKvToSchema(kv, symbol, tables) {
  const warnings = [];
  const errors = [];
  const extractedFields = [];
  const metadata = {};
  const usedKeys = new Set();

  /**
   * Look up a value by trying multiple possible label strings.
   * Case-insensitive, trims colons and extra whitespace.
   */
  function lookup(candidates, type = 'string', fieldName = null) {
    const normalizedKv = {};
    for (const [k, v] of Object.entries(kv)) {
      normalizedKv[k.toLowerCase().trim().replace(/:$/, '').replace(/\s+/g, ' ')] = { original: k, value: v };
    }

    for (const candidate of candidates) {
      const normalized = candidate.toLowerCase().trim();
      const found = normalizedKv[normalized];
      if (found) {
        usedKeys.add(found.original);
        const rawVal = String(found.value).trim();
        let normalizedResult;

        switch (type) {
          case 'number':
            normalizedResult = normalizeNumber(rawVal);
            break;
          case 'percentage':
            normalizedResult = normalizePercentage(rawVal);
            break;
          case 'date':
            normalizedResult = normalizeDate(rawVal);
            break;
          case 'integer':
            normalizedResult = normalizeInteger(rawVal);
            break;
          default:
            normalizedResult = normalizeString(rawVal);
        }

        if (normalizedResult.warning) {
          warnings.push(`${fieldName || candidate}: ${normalizedResult.warning}`);
        }

        extractedFields.push({
          field: fieldName || candidate,
          value: normalizedResult.value,
          rawValue: rawVal,
          source: {
            type: 'html_kv',
            selector: 'table',
            text: rawVal,
          },
          confidence: 0.85,
          warning: normalizedResult.warning || null,
        });

        return normalizedResult.value;
      }
    }
    return null;
  }

  const data = {
    symbol: symbol.toUpperCase(),

    // Identity
    companyName: lookup(['company name', 'name of the company', 'company', 'instrument name', 'name'], 'string', 'companyName'),
    scripCode: lookup(['scrip code', 'script code', 'code'], 'string', 'scripCode'),
    isin: lookup(['isin', 'isin code'], 'string', 'isin'),
    sector: lookup(['sector', 'sector name', 'industry sector'], 'string', 'sector'),
    industry: lookup(['industry', 'industry name'], 'string', 'industry'),
    category: lookup(['category', 'market category', 'instrument category'], 'string', 'category'),
    instrumentType: lookup(['instrument type', 'type'], 'string', 'instrumentType'),
    market: lookup(['market', 'exchange', 'market name'], 'string', 'market'),

    // Prices
    lastTradePrice: lookup(['ltp', 'last trade price', 'last traded price', 'last closing price'], 'number', 'lastTradePrice'),
    openPrice: lookup(['open', 'open price', 'opening price'], 'number', 'openPrice'),
    highPrice: lookup(['high', 'high price', "day's high"], 'number', 'highPrice'),
    lowPrice: lookup(['low', 'low price', "day's low"], 'number', 'lowPrice'),
    closePrice: lookup(['close', 'close price', 'closing price'], 'number', 'closePrice'),
    yesterdayClosePrice: lookup(['ycp', 'yesterday close price', 'yesterday closing price', 'previous close', 'prev close'], 'number', 'yesterdayClosePrice'),
    adjustedOpenPrice: lookup(['adjusted open', 'adjusted open price'], 'number', 'adjustedOpenPrice'),
    weekHigh52: lookup(['52 week high', '52-week high', '52wk high', '1 year high'], 'number', 'weekHigh52'),
    weekLow52: lookup(['52 week low', '52-week low', '52wk low', '1 year low'], 'number', 'weekLow52'),
    change: lookup(['change', 'price change', 'change (bdt)'], 'number', 'change'),
    changePercent: lookup(['% change', 'change%', 'change (%)', 'percent change'], 'percentage', 'changePercent'),

    // Trading
    volume: lookup(['volume', 'total volume', 'trade volume'], 'integer', 'volume'),
    tradeCount: lookup(['trade', 'no. of trades', 'number of trades', 'no of trades', 'trades'], 'integer', 'tradeCount'),
    turnover: lookup(['value', 'turnover', 'total value', 'total turnover'], 'number', 'turnover'),
    turnoverMn: lookup(['value (mn)', 'turnover (mn)', 'value mn'], 'number', 'turnoverMn'),

    // Capital structure
    marketCap: lookup(['market cap', 'market capitalization', 'market capitalisation'], 'number', 'marketCap'),
    freeFloatCap: lookup(['free float cap', 'free float', 'free-float cap'], 'number', 'freeFloatCap'),
    authorizedCapital: lookup(['authorised capital', 'authorized capital', 'auth. capital'], 'number', 'authorizedCapital'),
    paidUpCapital: lookup(['paid-up capital', 'paid up capital', 'paid-up cap', 'paid up cap'], 'number', 'paidUpCapital'),
    faceValue: lookup(['face value', 'nominal value', 'par value', 'fv'], 'number', 'faceValue'),
    totalSecurities: lookup(['total securities', 'total shares', 'no. of securities', 'no of securities', 'outstanding shares'], 'integer', 'totalSecurities'),

    // Financial
    eps: lookup(['eps', 'earnings per share', 'annual eps', 'basic eps'], 'number', 'eps'),
    epsQ1: lookup(['eps (jan-mar)', 'eps (q1)', 'q1 eps', 'eps jan-mar'], 'number', 'epsQ1'),
    epsH1: lookup(['eps (jan-jun)', 'eps (h1)', 'half year eps', 'eps jan-jun'], 'number', 'epsH1'),
    eps9M: lookup(['eps (jan-sep)', 'eps (9m)', '9 month eps', 'eps jan-sep'], 'number', 'eps9M'),
    dilutedEps: lookup(['diluted eps', 'diluted earnings per share'], 'number', 'dilutedEps'),
    navps: lookup(['navps', 'nav per share', 'net asset value per share', 'nav'], 'number', 'navps'),
    operatingCashFlow: lookup(['operating cash flow', 'cash from operations', 'ocf'], 'number', 'operatingCashFlow'),
    profit: lookup(['net profit', 'profit after tax', 'total profit'], 'number', 'profit'),
    peRatio: lookup(['p/e ratio', 'pe ratio', 'price/earnings', 'p/e', 'pe (basic)'], 'number', 'peRatio'),
    dilutedPeRatio: lookup(['diluted p/e', 'diluted pe', 'p/e (diluted)'], 'number', 'dilutedPeRatio'),

    // Corporate actions
    dividendYield: lookup(['dividend yield', 'div yield'], 'percentage', 'dividendYield'),
    cashDividend: lookup(['cash dividend', 'dividend', 'cash div'], 'number', 'cashDividend'),
    bonusIssue: lookup(['bonus issue', 'bonus share', 'stock dividend'], 'string', 'bonusIssue'),
    rightIssue: lookup(['right issue', 'rights issue', 'rights'], 'string', 'rightIssue'),
    agmDate: lookup(['agm date', 'agm', 'annual general meeting date'], 'date', 'agmDate'),
    yearEnded: lookup(['year ended', 'fiscal year', 'year end', 'financial year'], 'string', 'yearEnded'),
    dividendYear: lookup(['dividend year', 'dividend period'], 'string', 'dividendYear'),

    // Debt
    shortTermLoan: lookup(['short term loan', 'short-term loan', 'stl'], 'number', 'shortTermLoan'),
    longTermLoan: lookup(['long term loan', 'long-term loan', 'ltl'], 'number', 'longTermLoan'),
    totalLoan: lookup(['total loan', 'total debt'], 'number', 'totalLoan'),
    operationalStatus: lookup(['operational status', 'status'], 'string', 'operationalStatus'),

    // Listing
    listingYear: lookup(['listing year', 'year of listing', 'listed year'], 'string', 'listingYear'),
    debutTradingDate: lookup(['debut trading date', 'listing date', 'first trading date'], 'date', 'debutTradingDate'),
    electronicShare: lookup(['electronic share', 'e-share'], 'string', 'electronicShare'),

    // Ownership
    sponsorDirectorPercent: lookup(['sponsor-director', 'sponsor director', 'sponsor & director'], 'percentage', 'sponsorDirectorPercent'),
    institutionalPercent: lookup(['institute', 'institutional', 'institution'], 'percentage', 'institutionalPercent'),
    foreignPercent: lookup(['foreign', 'foreign investors'], 'percentage', 'foreignPercent'),
    publicPercent: lookup(['public', 'general public'], 'percentage', 'publicPercent'),

    metadata,
    extractedFields,
    extractionWarnings: warnings,
    extractionStrategy: 'html',
    extractedAt: new Date().toISOString(),
  };

  // Capture unused keys in metadata
  for (const [key, val] of Object.entries(kv)) {
    if (!usedKeys.has(key)) {
      metadata[key] = val;
    }
  }

  // Also store raw tables for debugging
  data.metadata._rawTableCount = tables.length;

  const meaningfulFields = [
    data.companyName, data.symbol, data.sector, data.category,
    data.lastTradePrice, data.eps, data.marketCap, data.volume,
  ].filter((v) => v !== null && v !== undefined);

  if (meaningfulFields.length < 2) {
    log.warn('HTML extraction yielded no meaningful fields', { symbol });
    return null;
  }

  return {
    success: true,
    strategy: 'html',
    data,
    warnings,
    errors,
  };
}

module.exports = { extract };
