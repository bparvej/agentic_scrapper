'use strict';

/**
 * Migration 001 — Create core instrument tables.
 *
 * Tables created:
 *   instruments              — Master instrument/company record (one per symbol)
 *   instrument_market_data   — Market price & trading data (updated frequently)
 *   instrument_financial_data — Financial metrics (EPS, NAV, P/E, capital structure)
 *   instrument_listing_data  — Listing & ownership information
 *
 * Design notes:
 *   - UUIDs for primary keys (portable between MySQL and PostgreSQL)
 *   - All numeric fields use DECIMAL for precision
 *   - All timestamps use DATETIME with UTC
 *   - JSON columns store flexible metadata
 *   - Unique constraint on `symbol` for idempotent upserts
 */

exports.up = async function (knex) {
  // ----------------------------------------------------------------
  // instruments — master record (one row per DSE symbol)
  // ----------------------------------------------------------------
  await knex.schema.createTable('instruments', (t) => {
    t.string('id', 36).primary();
    t.string('symbol', 20).notNullable().unique();
    t.string('company_name', 255);
    t.string('scrip_code', 20);
    t.string('isin', 20);
    t.string('sector', 100);
    t.string('industry', 100);
    t.string('category', 10);
    t.string('instrument_type', 50);
    t.string('market', 50);
    t.string('operational_status', 50);
    t.string('electronic_share', 20);
    t.string('listing_year', 10);
    t.date('debut_trading_date');
    t.json('metadata');
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    t.index('symbol');
  });

  // ----------------------------------------------------------------
  // instrument_market_data — latest market/price snapshot
  // ----------------------------------------------------------------
  await knex.schema.createTable('instrument_market_data', (t) => {
    t.string('id', 36).primary();
    t.string('instrument_id', 36).notNullable().references('id').inTable('instruments').onDelete('CASCADE');
    t.string('symbol', 20).notNullable();

    // Prices
    t.decimal('last_trade_price', 18, 4);
    t.decimal('open_price', 18, 4);
    t.decimal('high_price', 18, 4);
    t.decimal('low_price', 18, 4);
    t.decimal('close_price', 18, 4);
    t.decimal('yesterday_close_price', 18, 4);
    t.decimal('adjusted_open_price', 18, 4);
    t.decimal('week_high_52', 18, 4);
    t.decimal('week_low_52', 18, 4);
    t.decimal('change', 18, 4);
    t.decimal('change_percent', 10, 4);

    // Trading
    t.bigInteger('volume');
    t.integer('trade_count');
    t.decimal('turnover', 24, 4);
    t.decimal('turnover_mn', 18, 4);

    // Capital
    t.decimal('market_cap', 24, 4);
    t.decimal('free_float_cap', 24, 4);

    t.string('scraping_run_id', 36);
    t.datetime('scraped_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    t.index('instrument_id');
    t.index('symbol');
    t.index('scraped_at');
  });

  // ----------------------------------------------------------------
  // instrument_financial_data — financial metrics
  // ----------------------------------------------------------------
  await knex.schema.createTable('instrument_financial_data', (t) => {
    t.string('id', 36).primary();
    t.string('instrument_id', 36).notNullable().references('id').inTable('instruments').onDelete('CASCADE');
    t.string('symbol', 20).notNullable();

    // Capital structure
    t.decimal('authorized_capital', 24, 4);
    t.decimal('paid_up_capital', 24, 4);
    t.decimal('face_value', 18, 4);
    t.bigInteger('total_securities');

    // Financial performance
    t.decimal('eps', 18, 4);
    t.decimal('eps_q1', 18, 4);
    t.decimal('eps_h1', 18, 4);
    t.decimal('eps_9m', 18, 4);
    t.decimal('diluted_eps', 18, 4);
    t.decimal('navps', 18, 4);
    t.decimal('operating_cash_flow', 24, 4);
    t.decimal('profit', 24, 4);
    t.decimal('total_comprehensive_income', 24, 4);

    // Valuation
    t.decimal('pe_ratio', 18, 4);
    t.decimal('diluted_pe_ratio', 18, 4);

    // Corporate actions
    t.decimal('dividend_yield', 10, 4);
    t.decimal('cash_dividend', 18, 4);
    t.string('bonus_issue', 50);
    t.string('right_issue', 50);
    t.date('agm_date');
    t.string('year_ended', 50);
    t.string('dividend_year', 50);

    // Debt
    t.decimal('short_term_loan', 24, 4);
    t.decimal('long_term_loan', 24, 4);
    t.decimal('total_loan', 24, 4);

    t.string('scraping_run_id', 36);
    t.datetime('scraped_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    t.index('instrument_id');
    t.index('symbol');
  });

  // ----------------------------------------------------------------
  // instrument_listing_data — listing & ownership
  // ----------------------------------------------------------------
  await knex.schema.createTable('instrument_listing_data', (t) => {
    t.string('id', 36).primary();
    t.string('instrument_id', 36).notNullable().references('id').inTable('instruments').onDelete('CASCADE');
    t.string('symbol', 20).notNullable();

    // Ownership
    t.decimal('sponsor_director_percent', 10, 4);
    t.decimal('institutional_percent', 10, 4);
    t.decimal('foreign_percent', 10, 4);
    t.decimal('public_percent', 10, 4);

    t.string('scraping_run_id', 36);
    t.datetime('scraped_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('created_at').notNullable().defaultTo(knex.fn.now());
    t.datetime('updated_at').notNullable().defaultTo(knex.fn.now());

    t.index('instrument_id');
    t.index('symbol');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('instrument_listing_data');
  await knex.schema.dropTableIfExists('instrument_financial_data');
  await knex.schema.dropTableIfExists('instrument_market_data');
  await knex.schema.dropTableIfExists('instruments');
};
