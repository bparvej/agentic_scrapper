#!/usr/bin/env node
'use strict';

/**
 * CLI entry point for scraping a single DSE instrument.
 *
 * Usage:
 *   node src/cli/scrape.js BATBC
 *   node src/cli/scrape.js BATBC --debug
 *   node src/cli/scrape.js BATBC --no-browser
 *   node src/cli/scrape.js BATBC --force
 *
 * Or via npm:
 *   npm run scrape -- BATBC
 *   npm run scrape -- BATBC --debug
 */

require('../config');  // Load .env early

const Orchestrator = require('../agents/orchestrator/Orchestrator');
const { destroyConnection } = require('../database/knex');
const logger = require('../logging/logger');

const log = logger.createChild({ module: 'cli' });

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
DSE Agentic Scraper — CLI

Usage:
  npm run scrape -- <SYMBOL> [options]

Options:
  --debug       Enable debug logging
  --no-browser  Disable Playwright (headless browser) fallback
  --force       Skip duplicate checks

Examples:
  npm run scrape -- BATBC
  npm run scrape -- GP --debug
  npm run scrape -- SQURPHARMA --no-browser
`);
  process.exit(0);
}

const symbol = args[0];
const debug = args.includes('--debug');
const noBrowser = args.includes('--no-browser');
const force = args.includes('--force');

if (noBrowser) {
  process.env.DISABLE_PLAYWRIGHT = 'true';
}

async function run() {
  log.info('CLI scrape started', { symbol, debug, noBrowser, force });

  try {
    const result = await Orchestrator.scrape(symbol, { force, debug });

    console.log('\n' + '='.repeat(60));
    console.log('  DSE Agentic Scraper — Run Summary');
    console.log('='.repeat(60));
    console.log(`  Run ID:           ${result.runId}`);
    console.log(`  Symbol:           ${result.symbol}`);
    console.log(`  Status:           ${result.status}`);
    console.log(`  Strategy:         ${result.extractionStrategy || 'N/A'}`);
    console.log(`  Records Created:  ${result.recordsCreated}`);
    console.log(`  Records Updated:  ${result.recordsUpdated}`);
    console.log(`  Recovery Attempts:${result.recoveryAttempts}`);
    console.log(`  Duration:         ${(result.durationMs / 1000).toFixed(2)}s`);

    if (result.warnings.length > 0) {
      console.log(`\n  Warnings (${result.warnings.length}):`);
      result.warnings.slice(0, 5).forEach((w) => console.log(`    ⚠  ${w}`));
    }

    if (result.errors.length > 0) {
      console.log(`\n  Errors (${result.errors.length}):`);
      result.errors.slice(0, 5).forEach((e) => console.log(`    ✗  ${e}`));
    }

    console.log('='.repeat(60) + '\n');

    process.exitCode = result.status === 'completed' ? 0 : 1;
  } catch (err) {
    log.error('CLI scrape failed', { error: err.message });
    console.error(`\nFatal error: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await destroyConnection();
  }
}

run();
