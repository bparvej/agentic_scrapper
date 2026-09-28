'use strict';

/**
 * Migration 002 — Create scraping run tracking tables.
 *
 * Tables:
 *   scraping_runs      — One row per scraping execution
 *   scraping_errors    — Errors logged during a run
 *   scraping_anomalies — Anomalies detected during validation
 *   scraping_snapshots — Raw page content for debugging/replay
 */

exports.up = async function (knex) {
  // ----------------------------------------------------------------
  // scraping_runs
  // ----------------------------------------------------------------
  await knex.schema.createTable('scraping_runs', (t) => {
    t.string('id', 36).primary();
    t.string('run_id', 50).notNullable().unique();
    t.string('symbol', 20).notNullable();
    t.string('url', 512);
    t.string('status', 30).notNullable().defaultTo('pending');
    // pending | fetching | analyzing | extracting | validating | recovering
    // | persisting | completed | failed

    t.string('extraction_strategy', 30);
    t.integer('recovery_attempts').defaultTo(0);
    t.integer('records_created').defaultTo(0);
    t.integer('records_updated').defaultTo(0);

    t.boolean('validation_passed').defaultTo(false);
    t.json('warnings');     // array of warning strings
    t.json('errors');       // array of error objects

    // Human-in-the-loop support
    t.string('review_status', 20).defaultTo('not_required');
    // not_required | pending_review | approved | rejected

    t.datetime('started_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('completed_at');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    t.index('symbol');
    t.index('status');
    t.index('started_at');
  });

  // ----------------------------------------------------------------
  // scraping_errors
  // ----------------------------------------------------------------
  await knex.schema.createTable('scraping_errors', (t) => {
    t.string('id', 36).primary();
    t.string('scraping_run_id', 36).notNullable().references('run_id').inTable('scraping_runs').onDelete('CASCADE');
    t.string('symbol', 20);
    t.string('agent', 50);
    t.text('message');
    t.text('stack');
    t.datetime('occurred_at').notNullable().defaultTo(knex.fn.now());

    t.index('scraping_run_id');
  });

  // ----------------------------------------------------------------
  // scraping_anomalies
  // ----------------------------------------------------------------
  await knex.schema.createTable('scraping_anomalies', (t) => {
    t.string('id', 36).primary();
    t.string('scraping_run_id', 36).notNullable().references('run_id').inTable('scraping_runs').onDelete('CASCADE');
    t.string('symbol', 20).notNullable();
    t.string('field', 100).notNullable();
    t.string('severity', 20).notNullable(); // normal | warning | critical
    t.text('message');
    t.decimal('previous_value', 24, 4);
    t.decimal('current_value', 24, 4);
    t.decimal('change_percent', 10, 4);
    t.datetime('detected_at').notNullable().defaultTo(knex.fn.now());

    t.index('scraping_run_id');
    t.index('symbol');
    t.index('severity');
  });

  // ----------------------------------------------------------------
  // scraping_snapshots — raw page content for debugging
  // ----------------------------------------------------------------
  await knex.schema.createTable('scraping_snapshots', (t) => {
    t.string('id', 36).primary();
    t.string('scraping_run_id', 36).notNullable().references('run_id').inTable('scraping_runs').onDelete('CASCADE');
    t.string('symbol', 20).notNullable();
    t.string('source_url', 512);
    t.string('source_type', 30); // nextjs_data | html | playwright | api
    t.mediumtext('raw_payload');  // HTML or JSON snapshot
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());

    t.index('scraping_run_id');
    t.index('symbol');
    t.index('created_at');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('scraping_snapshots');
  await knex.schema.dropTableIfExists('scraping_anomalies');
  await knex.schema.dropTableIfExists('scraping_errors');
  await knex.schema.dropTableIfExists('scraping_runs');
};
