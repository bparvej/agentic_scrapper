'use strict';

const knex = require('knex');
const config = require('../config');
const logger = require('../logging/logger');

const log = logger.createChild({ module: 'database' });

/**
 * Knex database connection singleton.
 *
 * Supports MySQL (current) and PostgreSQL (future migration).
 * The client is selected via config.database.client ('mysql2' or 'pg').
 *
 * All database access goes through this connection —
 * never write raw SQL in application code.
 */

let _db = null;

function getDb() {
  if (_db) return _db;

  const client = config.database.client || 'mysql2';

  const knexConfig = {
    client,
    connection: {
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
    },
    pool: {
      min: 2,
      max: 10,
    },
    // Knex migrations configuration
    migrations: {
      directory: './src/database/migrations',
      tableName: 'knex_migrations',
    },
    seeds: {
      directory: './src/database/seeds',
    },
  };

  // PostgreSQL-specific: use `pg` client
  if (client === 'pg') {
    knexConfig.connection.ssl = process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false;
  }

  log.info('Creating database connection', { client, host: config.database.host, database: config.database.name });

  _db = knex(knexConfig);

  return _db;
}

/**
 * Test the database connection.
 * @returns {Promise<void>}
 */
async function testConnection() {
  const db = getDb();
  await db.raw('SELECT 1');
  log.info('Database connection successful');
}

/**
 * Destroy the connection pool (use in tests / graceful shutdown).
 */
async function destroyConnection() {
  if (_db) {
    await _db.destroy();
    _db = null;
    log.info('Database connection pool destroyed');
  }
}

/**
 * Reset singleton (for tests).
 */
function resetConnection() {
  _db = null;
}

module.exports = { getDb, testConnection, destroyConnection, resetConnection };
