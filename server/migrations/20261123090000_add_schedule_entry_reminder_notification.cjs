/**
 * Schedule entry reminders (S2): notification catalog.
 *
 *   - internal_notification_subtypes.toast_on_arrival (boolean NOT NULL DEFAULT false). Consumed by the web
 *     live toast (S4); only schedule-entry-reminder sets it.
 *   - category `schedule`, subtype `schedule-entry-reminder` (enabled by default, priority normal)
 *   - templates `schedule-entry-reminder` (lead > 0) and `schedule-entry-reminder-now` (lead = 0), 9 locales
 *
 * The column is added before the subtype row is flagged. Idempotent; nothing fires from this migration.
 */

const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { ALL_SCHEDULE_REMINDER_TEMPLATES, SUBTYPE_NAME } = require('./utils/templates/internal/scheduleEntryReminder.cjs');

exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE internal_notification_subtypes ADD COLUMN IF NOT EXISTS toast_on_arrival boolean NOT NULL DEFAULT false');
  await upsertCategoriesAndSubtypes(knex);
  // migration-lint: allow 8 - flags only the single new schedule-entry-reminder catalog row (by unique name) seeded just above; no existing subtype is modified
  await knex('internal_notification_subtypes')
    .where({ name: SUBTYPE_NAME })
    .update({ toast_on_arrival: true, default_priority: 'normal' });
  await upsertInternalTemplates(knex, ALL_SCHEDULE_REMINDER_TEMPLATES);
};

exports.down = async function down(knex) {
  for (const template of ALL_SCHEDULE_REMINDER_TEMPLATES) {
    await knex('internal_notification_templates').where({ name: template.templateName }).del();
  }
  const subtype = await knex('internal_notification_subtypes').where({ name: SUBTYPE_NAME }).first();
  if (subtype) {
    await knex('internal_notification_subtypes').where({ name: SUBTYPE_NAME }).del();
  }
  await knex('internal_notification_categories').where({ name: 'schedule' }).del();
  await knex.raw('ALTER TABLE internal_notification_subtypes DROP COLUMN IF EXISTS toast_on_arrival');
};

// Citus: category/subtype upserts cannot share a transaction with a parallel multi-shard operation.
exports.config = { transaction: false };
