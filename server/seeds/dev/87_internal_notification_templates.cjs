/**
 * Seed: Upsert all internal notification templates from source-of-truth files.
 *
 * Replaces the previous hand-coded template content with imports from
 * server/migrations/utils/templates/internal/. Templates are upserted (not
 * deleted first), so existing data is preserved.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const { upsertCategoriesAndSubtypes } = require('../../migrations/utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('../../migrations/utils/templates/_shared/upsertInternalTemplates.cjs');

const { TEMPLATES: ticketTemplates } = require('../../migrations/utils/templates/internal/tickets.cjs');
const { TEMPLATES: projectTemplates } = require('../../migrations/utils/templates/internal/projects.cjs');
const { TEMPLATES: invoiceTemplates } = require('../../migrations/utils/templates/internal/invoices.cjs');
const { TEMPLATES: systemTemplates } = require('../../migrations/utils/templates/internal/system.cjs');
const { TEMPLATES: appointmentTemplates } = require('../../migrations/utils/templates/internal/appointments.cjs');

const ALL_TEMPLATES = [
  ...ticketTemplates,
  ...projectTemplates,
  ...invoiceTemplates,
  ...systemTemplates,
  ...appointmentTemplates,
];

exports.seed = async function (knex) {
  console.log('Seed 87: Upserting internal notification templates from source-of-truth files...');

  // Ensure categories + subtypes exist
  await upsertCategoriesAndSubtypes(knex);

  // Upsert all internal notification templates
  await upsertInternalTemplates(knex, ALL_TEMPLATES, { skipMissingSubtype: true });

  console.log(`Seed 87: ${ALL_TEMPLATES.length} internal notification templates upserted.`);
};
