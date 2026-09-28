'use strict';

const logger = require('../../logging/logger');
const log = logger.createChild({ middleware: 'error-handler' });

/**
 * Global Express error handler.
 * Catches any error thrown from route handlers.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  log.error('Unhandled error', {
    method: req.method,
    url: req.url,
    error: err.message,
  });

  return res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}

module.exports = errorHandler;
