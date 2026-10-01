'use strict';

/**
 * Migration 003: Add corporate actions and news arrays
 */

module.exports = {
  up: async (knex) => {
    await knex.schema.alterTable('instruments', (table) => {
      // Use JSON columns to store arrays of structured objects
      table.json('corporate_actions').nullable();
      table.json('interim_financial_performance').nullable();
      table.json('financial_performance_audited').nullable();
      table.json('announcements').nullable();
    });
  },

  down: async (knex) => {
    await knex.schema.alterTable('instruments', (table) => {
      table.dropColumn('corporate_actions');
      table.dropColumn('interim_financial_performance');
      table.dropColumn('financial_performance_audited');
      table.dropColumn('announcements');
    });
  },
};
