'use strict';

const { upsertEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { getTemplate } = require('./utils/templates/email/opportunities/opportunityWeeklyDigest.cjs');
const { TEMPLATES } = require('./utils/templates/internal/opportunities.cjs');

exports.up = async function up(knex) {
  const [internalCategory] = await knex('internal_notification_categories')
    .insert({
      name: 'opportunities',
      description: 'Opportunity follow-through and digest notifications',
      is_enabled: true,
      is_default_enabled: true,
    })
    .onConflict('name')
    .merge({ description: knex.raw('excluded.description') })
    .returning('*');

  for (const subtype of [
    ['opportunity-stalled', 'An owned opportunity reaches its nudge threshold'],
    ['opportunity-escalated', 'An opportunity reaches its interrupt threshold'],
    ['opportunity-weekly-digest', 'Weekly opportunity owner digest'],
  ]) {
    await knex('internal_notification_subtypes')
      .insert({
        internal_category_id: internalCategory.internal_notification_category_id,
        name: subtype[0],
        description: subtype[1],
        is_enabled: true,
        is_default_enabled: true,
      })
      .onConflict(['internal_category_id', 'name'])
      .merge({ description: knex.raw('excluded.description') });
  }
  await upsertInternalTemplates(knex, TEMPLATES);

  const [emailCategory] = await knex('notification_categories')
    .insert({
      name: 'Opportunities',
      description: 'Opportunity follow-through and digest notifications',
      is_enabled: true,
      is_default_enabled: true,
    })
    .onConflict('name')
    .merge({ description: knex.raw('excluded.description') })
    .returning('*');
  await knex('notification_subtypes')
    .insert({
      category_id: emailCategory.id,
      name: 'Opportunity Weekly Digest',
      description: 'Weekly summary for opportunity owners',
      is_enabled: true,
      is_default_enabled: true,
    })
    .onConflict(['category_id', 'name'])
    .merge({ description: knex.raw('excluded.description') });
  await upsertEmailTemplate(knex, getTemplate());
};

exports.down = async function down(knex) {
  await knex('system_email_templates').where({ name: 'opportunity-weekly-digest' }).del();
  await knex('notification_subtypes').where({ name: 'Opportunity Weekly Digest' }).del();
  await knex('internal_notification_templates').whereIn('name', [
    'opportunity-stalled',
    'opportunity-escalated',
    'opportunity-weekly-digest',
  ]).del();
  await knex('internal_notification_subtypes').whereIn('name', [
    'opportunity-stalled',
    'opportunity-escalated',
    'opportunity-weekly-digest',
  ]).del();
  await knex('notification_categories').where({ name: 'Opportunities' }).whereNotExists(
    knex('notification_subtypes')
      .select(knex.raw('1'))
      .whereRaw('notification_subtypes.category_id = notification_categories.id')
  ).del();
  await knex('internal_notification_categories').where({ name: 'opportunities' }).whereNotExists(
    knex('internal_notification_subtypes')
      .select(knex.raw('1'))
      .whereRaw(
        'internal_notification_subtypes.internal_category_id = internal_notification_categories.internal_notification_category_id'
      )
  ).del();
};
