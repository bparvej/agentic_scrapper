'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../database/knex');
const logger = require('../logging/logger');

const log = logger.createChild({ repository: 'listing-data' });

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

  const existing = await db('instrument_listing_data')
    .where({ instrument_id: instrumentId })
    .first();

  const record = {
    sponsor_director_percent: data.sponsorDirectorPercent,
    institutional_percent: data.institutionalPercent,
    foreign_percent: data.foreignPercent,
    public_percent: data.publicPercent,
    scraping_run_id: scrapingRunId,
    scraped_at: now,
    updated_at: now,
  };

  if (existing) {
    await db('instrument_listing_data').where({ instrument_id: instrumentId }).update(record);
    log.debug('Listing data updated', { symbol });
    return { id: existing.id, created: false };
  } else {
    const id = uuidv4();
    await db('instrument_listing_data').insert({
      id,
      instrument_id: instrumentId,
      symbol,
      ...record,
      created_at: now,
    });
    log.debug('Listing data created', { symbol, id });
    return { id, created: true };
  }
}

module.exports = { upsert, upsertTrx };
