'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/knex');
const logger = require('../logging/logger');

const log = logger.createChild({ repository: 'market-data' });

/**
 * MarketDataRepository — CRUD for instrument_market_data.
 */

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

  const existing = await db('instrument_market_data')
    .where({ instrument_id: instrumentId })
    .first();

  const record = {
    last_trade_price: data.lastTradePrice,
    open_price: data.openPrice,
    high_price: data.highPrice,
    low_price: data.lowPrice,
    close_price: data.closePrice,
    yesterday_close_price: data.yesterdayClosePrice,
    adjusted_open_price: data.adjustedOpenPrice,
    week_high_52: data.weekHigh52,
    week_low_52: data.weekLow52,
    change: data.change,
    change_percent: data.changePercent,
    volume: data.volume,
    trade_count: data.tradeCount,
    turnover: data.turnover,
    turnover_mn: data.turnoverMn,
    market_cap: data.marketCap,
    free_float_cap: data.freeFloatCap,
    scraping_run_id: scrapingRunId,
    scraped_at: now,
    updated_at: now,
  };

  if (existing) {
    await db('instrument_market_data').where({ instrument_id: instrumentId }).update(record);
    log.debug('Market data updated', { symbol });
    return { id: existing.id, created: false };
  } else {
    const id = uuidv4();
    await db('instrument_market_data').insert({
      id,
      instrument_id: instrumentId,
      symbol,
      ...record,
      created_at: now,
    });
    log.debug('Market data created', { symbol, id });
    return { id, created: true };
  }
}

/**
 * Get the latest market data for a symbol.
 * @param {string} symbol
 * @returns {Promise<object|null>}
 */
async function findLatestBySymbol(symbol) {
  const db = getDb();
  const row = await db('instrument_market_data')
    .where({ symbol: symbol.toUpperCase() })
    .orderBy('scraped_at', 'desc')
    .first();
  return row || null;
}

module.exports = { upsert, upsertTrx, findLatestBySymbol };
