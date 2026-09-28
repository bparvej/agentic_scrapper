#!/usr/bin/env node
'use strict';

/**
 * Scrape all known instruments in sequence.
 *
 * Usage:
 *   npm run scrape:all
 *
 * Reads all symbols from the instruments table and scrapes each one.
 * Respects MAX_CONCURRENCY from config.
 */

require('../config');

const InstrumentRepository = require('../repositories/InstrumentRepository');
const Orchestrator = require('../agents/orchestrator/Orchestrator');
const { destroyConnection } = require('../database/knex');
const config = require('../config');
const logger = require('../logging/logger');
const { sleep } = require('../tools/http/HttpTool');

const log = logger.createChild({ module: 'cli:scrape-all' });

// Well-known DSE symbols as a starting seed if no instruments are in DB
const SEED_SYMBOLS = [
  'BATBC', 'GP', 'SQURPHARMA', 'BEXIMCO', 'BSRM',
  'RENATA', 'MARICO', 'BEXTEX', 'LHBL', 'GRAMEENPH',
];

async function run() {
  let symbols;

  try {
    const instruments = await InstrumentRepository.findAll();
    if (instruments.length > 0) {
      symbols = instruments.map((i) => i.symbol);
      log.info('Loaded symbols from database', { count: symbols.length });
    } else {
      log.warn('No instruments in DB, using seed symbols', { count: SEED_SYMBOLS.length });
      symbols = SEED_SYMBOLS;
    }
  } catch (err) {
    log.warn('DB not available, using seed symbols', { error: err.message });
    symbols = SEED_SYMBOLS;
  }

  const total = symbols.length;
  let success = 0;
  let failed = 0;
  const delay = config.http.delayMs;

  console.log(`\nScraping ${total} instruments...\n`);

  for (let i = 0; i < total; i++) {
    const symbol = symbols[i];
    process.stdout.write(`[${i + 1}/${total}] ${symbol.padEnd(15)} `);

    try {
      const result = await Orchestrator.scrape(symbol);
      if (result.status === 'completed') {
        process.stdout.write(`✓ ${result.extractionStrategy} +${result.recordsCreated}c/${result.recordsUpdated}u\n`);
        success++;
      } else {
        process.stdout.write(`✗ ${result.status} — ${result.errors[0] || 'unknown'}\n`);
        failed++;
      }
    } catch (err) {
      process.stdout.write(`✗ fatal: ${err.message}\n`);
      failed++;
    }

    // Respectful delay between requests
    if (i < total - 1) {
      await sleep(delay);
    }
  }

  console.log(`\nDone. Success: ${success}, Failed: ${failed}, Total: ${total}\n`);
  await destroyConnection();
  process.exitCode = failed > 0 ? 1 : 0;
}

run().catch((err) => {
  log.error('scrape:all failed', { error: err.message });
  process.exit(1);
});
