'use strict';

const { extractNextData, extractCompanyFromNextData } = require('../../tools/dse/DseTool');
const { normalizeNumber, normalizeString, normalizeDate, normalizePercentage, normalizeInteger } = require('../normalizers/valueNormalizer');
const logger = require('../../logging/logger');

const log = logger.createChild({ strategy: 'nextjs-data' });

/**
 * Strategy 1: Extract instrument data from Next.js __NEXT_DATA__ JSON.
 *
 * This is the preferred strategy — structured JSON is more reliable
 * than HTML parsing. It requires no selectors and is layout-independent.
 *
 * Returns null if __NEXT_DATA__ is not found or does not contain
 * recognisable company data.
 *
 * @param {string} html  - Full HTML of the fetched page
 * @param {string} symbol
 * @returns {ExtractionResult|null}
 *
 * @typedef {object} ExtractionResult
 * @property {boolean} success
 * @property {string} strategy
 * @property {object} data        - Normalised instrument fields
 * @property {string[]} warnings
 * @property {string[]} errors
 */
function extract(html, symbol) {
  log.debug('Attempting Next.js data extraction', { symbol });

  const nextData = extractNextData(html);
  if (!nextData) {
    log.debug('No __NEXT_DATA__ found', { symbol });
    return null;
  }

  const raw = extractCompanyFromNextData(nextData);
  if (!raw || Object.keys(raw).length === 0) {
    log.debug('__NEXT_DATA__ found but no company data inside', { symbol });
    return null;
  }

  log.info('__NEXT_DATA__ found, extracting company data', {
    symbol,
    keys: Object.keys(raw).slice(0, 10),
  });

  return _normalizeNextData(raw, symbol, nextData);
}

/**
 * Walk the raw Next.js page props and map known keys to our schema.
 * Unknown keys are captured in metadata.
 */
function _normalizeNextData(raw, symbol, nextData) {
  const warnings = [];
  const errors = [];
  const extractedFields = [];
  const metadata = {};

  /**
   * Helper: extract and normalise a field by trying multiple possible key names.
   */
  function pick(keys, type = 'string', label = null) {
    for (const key of keys) {
      if (raw[key] !== undefined && raw[key] !== null) {
        const rawVal = String(raw[key]);
        let normalized;

        switch (type) {
          case 'number':
            normalized = normalizeNumber(rawVal);
            break;
          case 'percentage':
            normalized = normalizePercentage(rawVal);
            break;
          case 'date':
            normalized = normalizeDate(rawVal);
            break;
          case 'integer':
            normalized = normalizeInteger(rawVal);
            break;
          default:
            normalized = normalizeString(rawVal);
        }

        if (normalized.warning) warnings.push(`${label || key}: ${normalized.warning}`);

        extractedFields.push({
          field: label || key,
          value: normalized.value,
          rawValue: rawVal,
          source: {
            type: 'nextjs_data',
            path: `props.pageProps.${key}`,
            text: rawVal,
          },
          confidence: 0.95,
          warning: normalized.warning || null,
        });

        return normalized.value;
      }
    }
    return null;
  }

  // Build the normalised instrument object
  const data = {
    symbol: symbol.toUpperCase(),

    // Identity
    companyName: pick(['companyName', 'company_name', 'name', 'fullName', 'full_name'], 'string', 'companyName'),
    scripCode: pick(['scripCode', 'scrip_code', 'scripcode'], 'string', 'scripCode'),
    isin: pick(['isin', 'ISIN'], 'string', 'isin'),
    sector: pick(['sector', 'sectorName', 'sector_name'], 'string', 'sector'),
    industry: pick(['industry', 'industryName'], 'string', 'industry'),
    category: pick(['category', 'instrumentCategory', 'market_category'], 'string', 'category'),
    instrumentType: pick(['instrumentType', 'instrument_type', 'type'], 'string', 'instrumentType'),
    market: pick(['market', 'marketName', 'exchange'], 'string', 'market'),

    // Market price
    lastTradePrice: pick(['ltp', 'lastTradePrice', 'last_trade_price', 'lastTradedPrice', 'close'], 'number', 'lastTradePrice'),
    openPrice: pick(['open', 'openPrice', 'open_price'], 'number', 'openPrice'),
    highPrice: pick(['high', 'highPrice', 'high_price'], 'number', 'highPrice'),
    lowPrice: pick(['low', 'lowPrice', 'low_price'], 'number', 'lowPrice'),
    closePrice: pick(['close', 'closePrice', 'close_price', 'closingPrice'], 'number', 'closePrice'),
    yesterdayClosePrice: pick(['ycp', 'yesterdayClosePrice', 'yesterday_close', 'prevClose'], 'number', 'yesterdayClosePrice'),
    weekHigh52: pick(['weekHigh52', '52weekHigh', 'week_high_52', 'yearHigh'], 'number', 'weekHigh52'),
    weekLow52: pick(['weekLow52', '52weekLow', 'week_low_52', 'yearLow'], 'number', 'weekLow52'),
    change: pick(['change', 'priceChange', 'price_change'], 'number', 'change'),
    changePercent: pick(['changePercent', 'change_percent', 'percentChange', 'pctChange'], 'percentage', 'changePercent'),

    // Trading
    volume: pick(['volume', 'totalVolume', 'total_volume'], 'integer', 'volume'),
    tradeCount: pick(['trade', 'tradeCount', 'trade_count', 'numberOfTrades'], 'integer', 'tradeCount'),
    turnover: pick(['turnover', 'totalTurnover', 'value'], 'number', 'turnover'),
    turnoverMn: pick(['turnoverMn', 'turnover_mn', 'valueMn'], 'number', 'turnoverMn'),

    // Capital structure
    marketCap: pick(['marketCap', 'market_cap', 'marketCapitalization'], 'number', 'marketCap'),
    freeFloatCap: pick(['freeFloatCap', 'free_float', 'freeFloat'], 'number', 'freeFloatCap'),
    authorizedCapital: pick(['authorizedCapital', 'authorized_capital', 'authorisedCapital'], 'number', 'authorizedCapital'),
    paidUpCapital: pick(['paidUpCapital', 'paid_up_capital', 'paidupCapital'], 'number', 'paidUpCapital'),
    faceValue: pick(['faceValue', 'face_value', 'fv', 'nominalValue'], 'number', 'faceValue'),
    totalSecurities: pick(['totalSecurities', 'total_securities', 'totalShares'], 'integer', 'totalSecurities'),

    // Financial
    eps: pick(['eps', 'EPS', 'earningsPerShare', 'annualEps'], 'number', 'eps'),
    epsQ1: pick(['epsQ1', 'eps_q1', 'q1Eps'], 'number', 'epsQ1'),
    epsH1: pick(['epsH1', 'eps_h1', 'halfYearEps'], 'number', 'epsH1'),
    eps9M: pick(['eps9M', 'eps_9m', 'nineMonthEps'], 'number', 'eps9M'),
    dilutedEps: pick(['dilutedEps', 'diluted_eps', 'dilutedEPS'], 'number', 'dilutedEps'),
    navps: pick(['navps', 'NAVPS', 'nav', 'netAssetValuePerShare'], 'number', 'navps'),
    operatingCashFlow: pick(['operatingCashFlow', 'operating_cash_flow', 'ocf'], 'number', 'operatingCashFlow'),
    profit: pick(['profit', 'netProfit', 'net_profit'], 'number', 'profit'),
    peRatio: pick(['pe', 'peRatio', 'pe_ratio', 'priceToEarnings'], 'number', 'peRatio'),
    dilutedPeRatio: pick(['dilutedPe', 'diluted_pe', 'dilutedPeRatio'], 'number', 'dilutedPeRatio'),

    // Corporate actions
    dividendYield: pick(['dividendYield', 'dividend_yield'], 'percentage', 'dividendYield'),
    cashDividend: pick(['cashDividend', 'cash_dividend', 'dividend'], 'number', 'cashDividend'),
    bonusIssue: pick(['bonusIssue', 'bonus_issue', 'bonus'], 'string', 'bonusIssue'),
    rightIssue: pick(['rightIssue', 'right_issue', 'rights'], 'string', 'rightIssue'),
    agmDate: pick(['agmDate', 'agm_date', 'agm'], 'date', 'agmDate'),
    yearEnded: pick(['yearEnded', 'year_ended', 'fiscalYear'], 'string', 'yearEnded'),
    dividendYear: pick(['dividendYear', 'dividend_year'], 'string', 'dividendYear'),

    // Listing
    listingYear: pick(['listingYear', 'listing_year'], 'string', 'listingYear'),
    debutTradingDate: pick(['debutTradingDate', 'debut_date', 'listingDate'], 'date', 'debutTradingDate'),
    electronicShare: pick(['electronicShare', 'electronic_share'], 'string', 'electronicShare'),

    // Ownership
    sponsorDirectorPercent: pick(['sponsorDirectorPercent', 'sponsor_director', 'sponsorDir'], 'percentage', 'sponsorDirectorPercent'),
    institutionalPercent: pick(['institutionalPercent', 'institutional', 'inst'], 'percentage', 'institutionalPercent'),
    foreignPercent: pick(['foreignPercent', 'foreign'], 'percentage', 'foreignPercent'),
    publicPercent: pick(['publicPercent', 'public'], 'percentage', 'publicPercent'),

    // Catch-all
    metadata,
    extractedFields,
    extractionWarnings: warnings,
    extractionStrategy: 'nextjs_data',
    extractedAt: new Date().toISOString(),
  };

  // Capture all unknown fields in metadata
  const knownKeys = new Set([
    'companyName', 'company_name', 'name', 'fullName', 'full_name',
    'scripCode', 'scrip_code', 'scripcode', 'isin', 'ISIN',
    'sector', 'sectorName', 'sector_name', 'industry', 'industryName',
    'category', 'instrumentCategory', 'market_category',
    'instrumentType', 'instrument_type', 'type', 'market', 'marketName', 'exchange',
    'ltp', 'lastTradePrice', 'last_trade_price', 'lastTradedPrice',
    'open', 'openPrice', 'open_price', 'high', 'highPrice', 'high_price',
    'low', 'lowPrice', 'low_price', 'close', 'closePrice', 'close_price', 'closingPrice',
    'ycp', 'yesterdayClosePrice', 'yesterday_close', 'prevClose',
    'weekHigh52', '52weekHigh', 'week_high_52', 'yearHigh',
    'weekLow52', '52weekLow', 'week_low_52', 'yearLow',
    'change', 'priceChange', 'price_change', 'changePercent', 'change_percent', 'percentChange', 'pctChange',
    'volume', 'totalVolume', 'total_volume', 'trade', 'tradeCount', 'trade_count', 'numberOfTrades',
    'turnover', 'totalTurnover', 'value', 'turnoverMn', 'turnover_mn', 'valueMn',
    'marketCap', 'market_cap', 'marketCapitalization', 'freeFloatCap', 'free_float', 'freeFloat',
    'authorizedCapital', 'authorized_capital', 'authorisedCapital', 'paidUpCapital', 'paid_up_capital', 'paidupCapital',
    'faceValue', 'face_value', 'fv', 'nominalValue', 'totalSecurities', 'total_securities', 'totalShares',
    'eps', 'EPS', 'earningsPerShare', 'annualEps', 'epsQ1', 'eps_q1', 'q1Eps', 'epsH1', 'eps_h1', 'halfYearEps',
    'eps9M', 'eps_9m', 'nineMonthEps', 'dilutedEps', 'diluted_eps', 'dilutedEPS',
    'navps', 'NAVPS', 'nav', 'netAssetValuePerShare', 'operatingCashFlow', 'operating_cash_flow', 'ocf',
    'profit', 'netProfit', 'net_profit', 'pe', 'peRatio', 'pe_ratio', 'priceToEarnings',
    'dilutedPe', 'diluted_pe', 'dilutedPeRatio', 'dividendYield', 'dividend_yield',
    'cashDividend', 'cash_dividend', 'dividend', 'bonusIssue', 'bonus_issue', 'bonus',
    'rightIssue', 'right_issue', 'rights', 'agmDate', 'agm_date', 'agm',
    'yearEnded', 'year_ended', 'fiscalYear', 'dividendYear', 'dividend_year',
    'listingYear', 'listing_year', 'debutTradingDate', 'debut_date', 'listingDate',
    'electronicShare', 'electronic_share', 'sponsorDirectorPercent', 'sponsor_director', 'sponsorDir',
    'institutionalPercent', 'institutional', 'inst', 'foreignPercent', 'foreign',
    'publicPercent', 'public',
  ]);

  for (const [key, val] of Object.entries(raw)) {
    if (!knownKeys.has(key) && val !== null && val !== undefined) {
      metadata[key] = val;
    }
  }

  // Check if we actually got anything meaningful
  const meaningfulFields = [
    data.companyName, data.lastTradePrice, data.sector, data.eps,
    data.marketCap, data.closePrice, data.volume,
  ].filter((v) => v !== null && v !== undefined);

  if (meaningfulFields.length === 0) {
    log.warn('__NEXT_DATA__ extraction yielded no meaningful fields', { symbol });
    return null;
  }

  return {
    success: true,
    strategy: 'nextjs_data',
    data,
    warnings,
    errors,
  };
}

module.exports = { extract };
