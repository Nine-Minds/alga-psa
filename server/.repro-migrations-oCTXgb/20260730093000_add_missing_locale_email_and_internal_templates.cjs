'use strict';

/**
 * Ship the newly added translations for the locale-gapped templates.
 *
 * The opportunity digest templates only had English copy, and the RMM alert /
 * inventory templates were defined inline in their own migrations without pt
 * (the RMM ones were English-only). All of them now live in
 * utils/templates as the single source of truth and carry every supported
 * locale. This migration re-upserts them from those modules, merging on
 * (name, language_code), so it is idempotent and a no-op once every row
 * matches the source of truth.
 */

const { upsertEmailTemplates } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { getTemplate: opportunityWeeklyDigest } = require('./utils/templates/email/opportunities/opportunityWeeklyDigest.cjs');
const { getTemplate: rmmAlertTriggered } = require('./utils/templates/email/rmm/rmmAlertTriggered.cjs');
const { TEMPLATES: opportunityInternalTemplates } = require('./utils/templates/internal/opportunities.cjs');
const { TEMPLATES: rmmInternalTemplates } = require('./utils/templates/internal/rmm.cjs');
const { TEMPLATES: inventoryInternalTemplates } = require('./utils/templates/internal/inventory.cjs');

exports.up = async function up(knex) {
  await upsertEmailTemplates(knex, [opportunityWeeklyDigest(), rmmAlertTriggered()]);
  await upsertInternalTemplates(knex, [
    ...opportunityInternalTemplates,
    ...rmmInternalTemplates,
    ...inventoryInternalTemplates,
  ]);

  console.log('Added missing locale rows for opportunity, RMM alert, and inventory templates.');
};

exports.down = async function down() {
  // No-op: template migrations are forward-only content corrections.
};
