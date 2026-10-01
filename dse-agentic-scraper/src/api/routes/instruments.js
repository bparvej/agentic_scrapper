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
    log.error('Get instrument error, falling back to mock data', { symbol, error: err.message });
    
    // Graceful fallback for POC presentation when DB is offline (like on Render)
    return res.json({
      instrument: {
        symbol,
        company_name: `${symbol} (Mocked Data)`,
        sector: 'Mocked Sector',
        corporate_actions: JSON.stringify([
          { year: '2025', dividend: '150% Cash', agm_date: '2026-04-15', record_date: '2026-03-01' },
          { year: '2024', dividend: '100% Cash, 5% Stock', agm_date: '2025-04-20', record_date: '2025-03-05' }
        ]),
        announcements: JSON.stringify([
          { date: new Date().toLocaleDateString(), title: 'Quarterly Earnings Report', description: 'The company reported a 20% increase in Q3 revenue compared to the same period last year.' },
          { date: 'Recent', title: 'Board Meeting Scheduled', description: 'A board meeting is scheduled next week to discuss dividend disbursements.' }
        ])
      },
      marketData: {
        last_trade_price: 250.50,
      },
      financialData: {
        eps: 12.5,
        pe_ratio: 20.0
      },
      _isMock: true
    });
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
