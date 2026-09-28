'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/knex');
const logger = require('../logging/logger');

const log = logger.createChild({ repository: 'instrument' });

/**
 * InstrumentRepository — all database operations for instruments.
 *
 * Uses Knex query builder exclusively.
 * No raw SQL from LLM output ever executes here.
 *
 * This repository is database-agnostic:
 * switching from MySQL to PostgreSQL requires only changing the Knex client.
 */

/**
 * Find an instrument by symbol.
 * @param {string} symbol
 * @returns {Promise<object|null>}
 */
async function findBySymbol(symbol) {
  const db = getDb();
  const row = await db('instruments').where({ symbol: symbol.toUpperCase() }).first();
  return row || null;
}

/**
 * Upsert with a Knex transaction object.
 */
async function upsertTrx(trx, data) {
  return _upsertWith(trx, data);
}

/**
 * Upsert an instrument record.
 * Creates if not exists, updates if exists (by symbol).
 *
 * @param {object} data - Normalised instrument data
 * @returns {Promise<{ id: string, created: boolean }>}
 */
async function upsert(data) {
  const db = getDb();
  return _upsertWith(db, data);
}

async function _upsertWith(db, data) {
  const symbol = data.symbol.toUpperCase();

  let existing = await db('instruments').where({ symbol }).first();
  const now = new Date();

  if (existing) {
    // Update
    await db('instruments')
      .where({ symbol })
      .update({
        company_name: data.companyName || existing.company_name,
        scrip_code: data.scripCode || existing.scrip_code,
        isin: data.isin || existing.isin,
        sector: data.sector || existing.sector,
        industry: data.industry || existing.industry,
        category: data.category || existing.category,
        instrument_type: data.instrumentType || existing.instrument_type,
        market: data.market || existing.market,
        operational_status: data.operationalStatus || existing.operational_status,
        electronic_share: data.electronicShare || existing.electronic_share,
        listing_year: data.listingYear || existing.listing_year,
        debut_trading_date: data.debutTradingDate || existing.debut_trading_date,
        metadata: data.metadata ? JSON.stringify(data.metadata) : existing.metadata,
        updated_at: now,
      });

    log.debug('Instrument updated', { symbol });
    return { id: existing.id, created: false };
  } else {
    // Insert
    const id = uuidv4();
    await db('instruments').insert({
      id,
      symbol,
      company_name: data.companyName,
      scrip_code: data.scripCode,
      isin: data.isin,
      sector: data.sector,
      industry: data.industry,
      category: data.category,
      instrument_type: data.instrumentType,
      market: data.market,
      operational_status: data.operationalStatus,
      electronic_share: data.electronicShare,
      listing_year: data.listingYear,
      debut_trading_date: data.debutTradingDate,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      created_at: now,
      updated_at: now,
    });

    log.debug('Instrument created', { symbol, id });
    return { id, created: true };
  }
}

/**
 * Find all instruments (for scrape:all).
 * @returns {Promise<object[]>}
 */
async function findAll() {
  const db = getDb();
  return db('instruments').select('*').orderBy('symbol');
}

module.exports = { findBySymbol, upsert, upsertTrx, findAll };
