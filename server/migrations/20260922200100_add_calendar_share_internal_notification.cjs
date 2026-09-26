/**
 * Seed the internal notification sent when a colleague shares their calendar
 * with a user (shared calendars, 2026-09-22).
 */

const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { TEMPLATES } = require('./utils/templates/internal/calendarShareGranted.cjs');

exports.up = async function up(knex) {
  await upsertCategoriesAndSubtypes(knex);
  await upsertInternalTemplates(knex, [TEMPLATES]);
};

exports.down = async function down(knex) {
  await knex('internal_notification_templates').where({ name: TEMPLATES.templateName }).del();
  await knex('internal_notification_subtypes').where({ name: TEMPLATES.subtypeName }).del();
};
