'use strict';

const express = require('express');
const Orchestrator = require('../../agents/orchestrator/Orchestrator');
const ScrapingRunRepository = require('../../repositories/ScrapingRunRepository');
const logger = require('../../logging/logger');

const router = express.Router();
const log = logger.createChild({ route: 'scrape' });

/**
 * POST /api/scrape/instrument
 *
 * Start a scraping run for a DSE instrument symbol.
 *
 * Request body:
 *   { "symbol": "BATBC", "force": false }
 *
 * Response:
 *   { "runId": "...", "symbol": "BATBC", "status": "completed", ... }
 */
router.post('/instrument', async (req, res) => {
  const { symbol, force = false } = req.body || {};

  if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
    return res.status(400).json({ error: 'symbol is required' });
  }

  const clean = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]+$/.test(clean)) {
    return res.status(400).json({ error: `Invalid symbol: ${symbol}` });
  }

  log.info('Scrape request received', { symbol: clean });

  try {
    const result = await Orchestrator.scrape(clean, { force });
    const httpStatus = result.status === 'completed' ? 200 : 207;
    return res.status(httpStatus).json(result);
  } catch (err) {
    log.error('Scrape endpoint error', { symbol: clean, error: err.message });
    return res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
});

/**
 * GET /api/scrape/runs/:runId
 *
 * Get details of a specific scraping run.
 */
router.get('/runs/:runId', async (req, res) => {
  const { runId } = req.params;

  try {
    const run = await ScrapingRunRepository.findByRunId(runId);
    if (!run) {
      return res.status(404).json({ error: `Run not found: ${runId}` });
    }
    return res.json(run);
  } catch (err) {
    log.error('Get run error', { runId, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/scrape/history/:symbol
 *
 * Get recent scraping history for a symbol.
 */
router.get('/history/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const limit = Math.min(parseInt(req.query.limit || '10', 10), 100);

  try {
    const runs = await ScrapingRunRepository.findRecentBySymbol(symbol.toUpperCase(), limit);
    return res.json({ symbol: symbol.toUpperCase(), runs });
  } catch (err) {
    log.error('Get history error', { symbol, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
