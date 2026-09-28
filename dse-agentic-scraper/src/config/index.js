'use strict';

require('dotenv').config();

/**
 * Central configuration object.
 * All environment variables are read here so the rest of the app
 * never calls process.env directly — making them easy to find, validate,
 * and mock in tests.
 */
const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  database: {
    client: process.env.DATABASE_CLIENT || 'mysql2',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '3306', 10),
    name: process.env.DATABASE_NAME || 'dse_agentic',
    user: process.env.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD || '',
  },

  llm: {
    provider: process.env.LLM_PROVIDER || 'mock',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    apiKey: process.env.LLM_API_KEY || '',
    apiBaseUrl: process.env.LLM_API_BASE_URL || '',
  },

  dse: {
    baseUrl: process.env.DSE_BASE_URL || 'https://dse.com.bd',
  },

  http: {
    timeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '15000', 10),
    delayMs: parseInt(process.env.REQUEST_DELAY_MS || '1000', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '3', 10),
  },

  workflow: {
    maxRecoveryAttempts: parseInt(process.env.MAX_RECOVERY_ATTEMPTS || '3', 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
  },

  snapshots: {
    retentionDays: parseInt(process.env.SNAPSHOT_RETENTION_DAYS || '30', 10),
  },

  playwright: {
    disabled: process.env.DISABLE_PLAYWRIGHT === 'true',
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
  },
};

/**
 * Validate required configuration values.
 * Warns (does not crash) so the app can still run in mock/dev mode.
 */
function validateConfig() {
  const warnings = [];

  if (config.llm.provider !== 'mock' && !config.llm.apiKey) {
    warnings.push('LLM_API_KEY is not set — LLM features will not work');
  }

  if (!config.database.password && config.env === 'production') {
    warnings.push('DATABASE_PASSWORD is empty in production');
  }

  return warnings;
}

config.validate = validateConfig;

module.exports = config;
