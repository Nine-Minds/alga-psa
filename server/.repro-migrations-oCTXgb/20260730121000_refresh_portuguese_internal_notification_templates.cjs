/**
 * Re-upsert every Brazilian Portuguese internal notification template from the
 * source-of-truth modules.
 *
 * Same drift as the email templates: copy edits landed after
 * 20260625121000_add_portuguese_internal_notification_templates.cjs had run, so
 * rows kept the pre-review wording. Replaying the upsert resyncs them and is a
 * no-op for rows that already match.
 */

const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const {
  buildPortugueseRows,
  upsertPortugueseInternalRows,
} = require('./20260625121000_add_portuguese_internal_notification_templates.cjs');

exports.up = async function up(knex) {
  await upsertCategoriesAndSubtypes(knex);
  const subtypes = await knex('internal_notification_subtypes')
    .select('internal_notification_subtype_id', 'name');
  const rows = buildPortugueseRows(subtypes);
  await upsertPortugueseInternalRows(knex, rows);
  console.log(`Refreshed ${rows.length} Brazilian Portuguese internal notification templates.`);
};

exports.down = async function down() {
  // No-op: notification template migrations are forward-only content corrections.
};

// Citus: internal_notification_categories/subtypes are FK'd from the
// distributed internal_notifications table, so this upsert cannot share a
// transaction with a parallel multi-shard operation from another migration in
// the batch. The upserts are idempotent, so no transaction is safe.
exports.config = { transaction: false };
