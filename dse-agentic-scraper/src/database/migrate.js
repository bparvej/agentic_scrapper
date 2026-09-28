'use strict';

/**
 * Database migration runner.
 *
 * Usage:
 *   node src/database/migrate.js           # run pending migrations
 *   node src/database/migrate.js rollback  # rollback last batch
 *   node src/database/migrate.js status    # show migration status
 */

const { getDb, destroyConnection } = require('./knex');
const logger = require('../logging/logger');

const log = logger.createChild({ module: 'migrate' });

async function main() {
  const command = process.argv[2] || 'latest';
  const db = getDb();

  try {
    if (command === 'rollback') {
      log.info('Rolling back last migration batch...');
      const [batch, migrations] = await db.migrate.rollback();
      log.info(`Rolled back batch ${batch}`, { migrations });
    } else if (command === 'status') {
      const [completed, pending] = await db.migrate.list();
      log.info('Migration status', {
        completed: completed.map((m) => m.name),
        pending: pending.map((m) => m.name),
      });
    } else {
      log.info('Running pending migrations...');
      const [batch, migrations] = await db.migrate.latest();
      if (migrations.length === 0) {
        log.info('No pending migrations');
      } else {
        log.info(`Ran batch ${batch}`, { migrations });
      }
    }
  } catch (err) {
    log.error('Migration failed', { error: err.message });
    process.exitCode = 1;
  } finally {
    await destroyConnection();
  }
}

main();
