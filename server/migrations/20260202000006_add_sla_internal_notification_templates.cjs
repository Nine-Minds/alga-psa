/**
 * Add SLA notification category, subtypes, and templates for internal notifications.
 *
 * Creates:
 * - New 'sla' category in internal_notification_categories
 * - Subtypes: sla-warning, sla-breach, sla-response-met, sla-resolution-met, sla-escalation
 * - English templates for each subtype
 *
 * Uses the shared source-of-truth template pattern.
 */

const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { TEMPLATES } = require('./utils/templates/internal/sla.cjs');

exports.up = async function(knex) {
  console.log('Adding SLA internal notification category, subtypes, and templates...');

  // 1. Upsert all internal notification categories & subtypes (including SLA)
  await upsertCategoriesAndSubtypes(knex);
  console.log('  ✓ Internal categories & subtypes upserted');

  // 2. Upsert SLA templates from source-of-truth
  await upsertInternalTemplates(knex, TEMPLATES);
  console.log(`  ✓ ${TEMPLATES.length} SLA internal notification templates upserted`);

  console.log('Successfully added SLA internal notification templates');
};

exports.down = async function(knex) {
  console.log('Removing SLA internal notification templates...');

  // Delete templates
  await knex('internal_notification_templates')
    .whereIn('name', [
      'sla-warning-50',
      'sla-warning-75',
      'sla-warning-90',
      'sla-breach',
      'sla-response-met',
      'sla-resolution-met',
      'sla-escalation'
    ])
    .delete();

  // Delete subtypes
  await knex('internal_notification_subtypes')
    .whereIn('name', [
      'sla-warning',
      'sla-breach',
      'sla-response-met',
      'sla-resolution-met',
      'sla-escalation'
    ])
    .delete();

  // Delete category (only if no other subtypes exist)
  const remainingSubtypes = await knex('internal_notification_subtypes')
    .join('internal_notification_categories', 'internal_notification_subtypes.internal_category_id', 'internal_notification_categories.internal_notification_category_id')
    .where('internal_notification_categories.name', 'sla')
    .count('* as count')
    .first();

  if (Number(remainingSubtypes?.count || 0) === 0) {
    await knex('internal_notification_categories')
      .where('name', 'sla')
      .delete();
  }

  console.log('Successfully removed SLA internal notification templates');
};
