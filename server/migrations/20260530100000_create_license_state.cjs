'use strict';

/**
 * Creates the license_state singleton table in the admin DB.
 *
 * This is an install-level record (at most one row) used by self-hosted
 * appliance installs to drive offline license/trial resolution. Its presence
 * activates the self-host licensing path; absence preserves the existing
 * SaaS/Stripe resolution.
 *
 * edition_choice : 'ce' | 'ee'  — what was chosen at appliance setup
 * trial_started_at               — set when a 15-day Enterprise trial begins
 * license_token                  — the signed JWT for an active license (or null)
 * updated_at                     — last modification timestamp
 */
exports.up = async function (knex) {
  await knex.schema.createTable('license_state', (table) => {
    table.increments('id').primary();
    table.text('edition_choice').notNullable().defaultTo('ce');
    table.timestamp('trial_started_at', { useTz: true }).nullable();
    table.text('license_token').nullable();
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('license_state');
};
