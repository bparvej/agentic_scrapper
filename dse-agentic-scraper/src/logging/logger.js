'use strict';

const winston = require('winston');
const config = require('../config');

/**
 * Structured logger.
 *
 * Usage:
 *   const logger = require('./logger').child({ agent: 'extraction-agent' });
 *   logger.info('Extracting data', { symbol: 'BATBC' });
 *
 * IMPORTANT: Never log API keys, DB passwords, or secrets.
 */
const { combine, timestamp, json, colorize, simple } = winston.format;

const transports = [
  new winston.transports.Console({
    format:
      config.logging.format === 'json'
        ? combine(timestamp(), json())
        : combine(colorize(), simple()),
  }),
];

const logger = winston.createLogger({
  level: config.logging.level,
  transports,
  // Prevent winston from exiting on uncaught exceptions — let the app handle it
  exitOnError: false,
});

/**
 * Create a child logger with extra default metadata.
 *
 * @param {object} meta - e.g. { agent: 'validation-agent', runId: '...' }
 * @returns {winston.Logger}
 */
logger.createChild = function createChild(meta) {
  return logger.child(meta);
};

module.exports = logger;
