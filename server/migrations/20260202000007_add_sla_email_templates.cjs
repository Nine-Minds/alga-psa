/**
 * Migration: Add SLA Email notification category, subtypes, and templates.
 *
 * Creates email notification infrastructure for SLA alerts:
 * - SLA category in notification_categories
 * - Subtypes: SLA Warning, SLA Breach, SLA Escalation
 * - English email templates with HTML and text versions
 *
 * Uses the shared source-of-truth template pattern.
 */

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { getTemplate: slaWarning } = require('./utils/templates/email/sla/slaWarning.cjs');
const { getTemplate: slaBreach } = require('./utils/templates/email/sla/slaBreach.cjs');
const { getTemplate: slaEscalation } = require('./utils/templates/email/sla/slaEscalation.cjs');

const SLA_TEMPLATES = [slaWarning, slaBreach, slaEscalation];

exports.up = async function(knex) {
  console.log('Adding SLA email notification category, subtypes, and templates...');

  // 1. Upsert all email notification categories & subtypes (including SLA)
  await upsertEmailCategoriesAndSubtypes(knex);
  console.log('  ✓ Email categories & subtypes upserted');

  // 2. Upsert SLA email templates from source-of-truth
  for (const getter of SLA_TEMPLATES) {
    const def = getter();
    await upsertEmailTemplate(knex, def);
  }
  console.log(`  ✓ ${SLA_TEMPLATES.length} SLA email templates upserted`);

  console.log('Successfully added SLA email notification templates');
};

exports.down = async function(knex) {
  console.log('Removing SLA email notification templates...');

  // Delete templates
  await knex('system_email_templates')
    .whereIn('name', ['sla-warning', 'sla-breach', 'sla-escalation'])
    .delete();

  // Delete subtypes
  await knex('notification_subtypes')
    .whereIn('name', ['SLA Warning', 'SLA Breach', 'SLA Escalation'])
    .delete();

  // Delete category if empty
  const slaCategory = await knex('notification_categories')
    .where({ name: 'SLA' })
    .first();

  if (slaCategory) {
    const remainingSubtypes = await knex('notification_subtypes')
      .where({ category_id: slaCategory.id })
      .count('* as count')
      .first();

    if (Number(remainingSubtypes?.count || 0) === 0) {
      await knex('notification_categories')
        .where({ name: 'SLA' })
        .delete();
    }
  }

  console.log('Successfully removed SLA email notification templates');
};
