'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/knex');
const logger = require('../logging/logger');

const log = logger.createChild({ repository: 'financial-data' });

async function upsert(instrumentId, data, scrapingRunId) {
  const db = getDb();
  return _upsertWith(db, instrumentId, data, scrapingRunId);
}

async function upsertTrx(trx, instrumentId, data, scrapingRunId) {
  return _upsertWith(trx, instrumentId, data, scrapingRunId);
}

async function _upsertWith(db, instrumentId, data, scrapingRunId) {
  const symbol = data.symbol.toUpperCase();
  const now = new Date();

  const existing = await db('instrument_financial_data')
    .where({ instrument_id: instrumentId })
    .first();

  const record = {
    authorized_capital: data.authorizedCapital,
    paid_up_capital: data.paidUpCapital,
    face_value: data.faceValue,
    total_securities: data.totalSecurities,
    eps: data.eps,
    eps_q1: data.epsQ1,
    eps_h1: data.epsH1,
    eps_9m: data.eps9M,
    diluted_eps: data.dilutedEps,
    navps: data.navps,
    operating_cash_flow: data.operatingCashFlow,
    profit: data.profit,
    total_comprehensive_income: data.totalComprehensiveIncome,
    pe_ratio: data.peRatio,
    diluted_pe_ratio: data.dilutedPeRatio,
    dividend_yield: data.dividendYield,
    cash_dividend: data.cashDividend,
    bonus_issue: data.bonusIssue,
    right_issue: data.rightIssue,
    agm_date: data.agmDate,
    year_ended: data.yearEnded,
    dividend_year: data.dividendYear,
    short_term_loan: data.shortTermLoan,
    long_term_loan: data.longTermLoan,
    total_loan: data.totalLoan,
    scraping_run_id: scrapingRunId,
    scraped_at: now,
    updated_at: now,
  };

  if (existing) {
    await db('instrument_financial_data').where({ instrument_id: instrumentId }).update(record);
    log.debug('Financial data updated', { symbol });
    return { id: existing.id, created: false };
  } else {
    const id = uuidv4();
    await db('instrument_financial_data').insert({
      id,
      instrument_id: instrumentId,
      symbol,
      ...record,
      created_at: now,
    });
    log.debug('Financial data created', { symbol, id });
    return { id, created: true };
  }
}

async function findLatestBySymbol(symbol) {
  const db = getDb();
  return db('instrument_financial_data')
    .where({ symbol: symbol.toUpperCase() })
    .orderBy('scraped_at', 'desc')
    .first() || null;
}

module.exports = { upsert, upsertTrx, findLatestBySymbol };
