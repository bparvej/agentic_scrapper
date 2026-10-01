'use strict';

const express = require('express');
const InstrumentRepository = require('../../repositories/InstrumentRepository');
const MarketDataRepository = require('../../repositories/MarketDataRepository');
const FinancialDataRepository = require('../../repositories/FinancialDataRepository');
const dseFlightStrategy = require('../../extraction/strategies/dseFlightStrategy');
const logger = require('../../logging/logger');

const router = express.Router();
const log = logger.createChild({ route: 'instruments' });

/**
 * GET /api/instruments/:symbol
 *
 * Live-scrape from DSE + DB fallback.
 * Always tries to pull fresh data from DSE's RSC payload first.
 * Falls back to DB if DSE scrape fails, falls back to mock if DB is also offline.
 */
router.get('/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  // Step 1: Try live DSE scrape
  try {
    log.info('Attempting live DSE flight scrape', { symbol });
    const scraped = await dseFlightStrategy.extract(symbol);

    if (scraped && scraped.success && scraped.data) {
      const d = scraped.data;
      log.info('Live scrape succeeded', { symbol });
      return res.json({
        instrument: {
          symbol: d.symbol,
          company_name: d.companyName,
          sector: d.sector,
          category: d.category,
          instrument_type: d.instrumentType,
          market: d.market,
          scrip_code: d.scripCode,
          listing_year: d.listingYear,
          face_value: d.faceValue,
          website: d.website,
          hq: d.hq,
          agm_date: d.agmDate,
          year_end: d.yearEnd,
          description: d.description,
          authorized_capital: d.authorizedCapital,
          paid_up_capital: d.paidUpCapital,
          reserve_without_oci: d.reserveWithoutOci,
          short_term_loan: d.shortTermLoan,
          long_term_loan: d.longTermLoan,
          sponsor_percent: d.sponsorPercent,
          institution_percent: d.institutionPercent,
          foreign_percent: d.foreignPercent,
          public_percent: d.publicPercent,
          // Card 2: Interim Financials
          interim_financial_performance: JSON.stringify(d.interimFinancials),
          // Card 3: Audited Financials
          financial_performance_audited: JSON.stringify(d.auditedFinancials),
          // Card 4: Continued
          financial_continued: JSON.stringify(d.financialContinued),
          // Card 5 & 6: P/E Tables
          pe_unaudited_table: JSON.stringify(d.peUnauditedTable),
          pe_audited_table: JSON.stringify(d.peAuditedTable),
          latest_pe_unaudited: d.latestPeUnaudited,
          latest_pe_audited: d.latestPeAudited,
          pe_trend: JSON.stringify(d.peTrend || []),
          // Extra
          dividend_history: JSON.stringify(d.dividendHistory),
          announcements: JSON.stringify([]),
          corporate_actions: JSON.stringify([]),
        },
        marketData: {
          last_trade_price: d.lastTradePrice,
          open_price: d.open,
          high_price: d.high,
          low_price: d.low,
          prev_close: d.prevClose,
          change: d.change,
          change_pct: d.changePct,
          volume: d.volume,
          trades: d.trades,
          market_cap: d.marketCap,
          free_float: d.freeFloat,
          week_high_52: d.weekHigh52,
          week_low_52: d.weekLow52,
        },
        financialData: {
          eps: d.eps,
          nav: d.nav,
          pe_ratio: d.peRatio,
          dividend_yield: d.dividendYield,
          latest_pe_unaudited: d.latestPeUnaudited,
          latest_pe_audited: d.latestPeAudited,
          pe_trend: JSON.stringify(d.peTrend || []),
        },
        _source: 'live_dse_scrape',
      });
    }
  } catch (scrapeErr) {
    log.warn('Live DSE scrape failed, trying DB', { symbol, error: scrapeErr.message });
  }

  // Step 2: Try DB
  try {
    const instrument = await InstrumentRepository.findBySymbol(symbol);
    if (!instrument) {
      return res.status(404).json({ error: `Instrument not found: ${symbol}` });
    }
    const [marketData, financialData] = await Promise.all([
      MarketDataRepository.findLatestBySymbol(symbol),
      FinancialDataRepository.findLatestBySymbol(symbol),
    ]);
    return res.json({ instrument, marketData: marketData || null, financialData: financialData || null, _source: 'db' });
  } catch (dbErr) {
    log.error('DB also failed, using mock', { symbol, error: dbErr.message });
  }

  // Step 3: Rich mock fallback (for POC / offline environments)
  return res.json({
    instrument: {
      symbol,
      company_name: `${symbol} — Live data unavailable`,
      sector: 'N/A',
      category: 'N/A',
      interim_financial_performance: JSON.stringify({
        periods: ['Q1\nEnding on 202509', 'Q2\nEnding on 202512', 'Half Yearly\nEnding on 202512', 'Q3\nEnding on 202603', '9 Months\nEnding on 202603', 'Annual'],
        rows: [
          { particulars: 'Earnings Per Share (EPS) Basic',        values: ['-', '-', '-', '-', '-', '-'] },
          { particulars: 'Earnings Per Share (EPS) Diluted*',     values: ['-', '-', '-', '-', '-', '-'] },
          { particulars: 'EPS - Continuing Operations Basic',     values: ['-', '-', '-', '-', '-', '-'] },
          { particulars: 'EPS - Continuing Operations Diluted*',  values: ['-', '-', '-', '-', '-', '-'] },
          { particulars: 'Market price per share at period end',  values: ['-', '-', '-', '-', '-', '-'] },
        ],
      }),
      financial_performance_audited: JSON.stringify([
        { year: '2025', epsBasic: '-', epsContBasic: '-', nav: '-', profit: '-', pe: '-', dividendPct: '-' },
        { year: '2024', epsBasic: '-', epsContBasic: '-', nav: '-', profit: '-', pe: '-', dividendPct: '-' },
      ]),
      financial_continued: JSON.stringify([]),
      pe_unaudited_table: null,
      pe_audited_table: null,
      latest_pe_unaudited: null,
      latest_pe_audited: null,
      announcements: JSON.stringify([]),
      corporate_actions: JSON.stringify([]),
      dividend_history: JSON.stringify([]),
    },
    marketData: { last_trade_price: null },
    financialData: { eps: null, pe_ratio: null },
    _source: 'mock',
  });
});

/**
 * GET /api/instruments
 * List all scraped instruments.
 */
router.get('/', async (req, res) => {
  try {
    const instruments = await InstrumentRepository.findAll();
    return res.json({ count: instruments.length, instruments });
  } catch (err) {
    log.error('List instruments error', { error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
