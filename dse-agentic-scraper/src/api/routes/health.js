'use strict';

const express = require('express');
const { testConnection } = require('../../database/knex');

const router = express.Router();

/**
 * GET /api/health
 *
 * Health check endpoint.
 * Returns 200 if the application and database are healthy.
 */
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: require('../../../package.json').version,
    services: {
      database: 'unknown',
    },
  };

  try {
    await testConnection();
    health.services.database = 'ok';
  } catch (err) {
    health.services.database = 'error';
    health.status = 'degraded';
  }

  const httpStatus = health.status === 'ok' ? 200 : 503;
  return res.status(httpStatus).json(health);
});

module.exports = router;
