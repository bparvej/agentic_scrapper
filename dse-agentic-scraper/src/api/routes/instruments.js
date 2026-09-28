'use strict';

const express = require('express');
const InstrumentRepository = require('../../repositories/InstrumentRepository');
const MarketDataRepository = require('../../repositories/MarketDataRepository');
const FinancialDataRepository = require('../../repositories/FinancialDataRepository');
const logger = require('../../logging/logger');

const router = express.Router();
const log = logger.createChild({ route: 'instruments' });

/**
 * GET /api/instruments/:symbol
 *
 * Get the latest data for a DSE instrument.
 */
router.get('/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();

  try {
    const instrument = await InstrumentRepository.findBySymbol(symbol);
    if (!instrument) {
      return res.status(404).json({ error: `Instrument not found: ${symbol}` });
    }

    const [marketData, financialData] = await Promise.all([
      MarketDataRepository.findLatestBySymbol(symbol),
      FinancialDataRepository.findLatestBySymbol(symbol),
    ]);

    return res.json({
      instrument,
      marketData: marketData || null,
      financialData: financialData || null,
    });
  } catch (err) {
    log.error('Get instrument error', { symbol, error: err.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/instruments
 *
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
