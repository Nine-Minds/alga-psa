/**
 * Re-upsert every Brazilian Portuguese email template from the source-of-truth
 * modules.
 *
 * Translation edits landed in the template modules after
 * 20260625120000_add_portuguese_email_templates.cjs had already run, so those
 * rows still carry the pre-review copy in any environment migrated before the
 * edits. Replaying the same upsert brings every `pt` row back in sync and is a
 * no-op for rows that already match.
 */

const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const {
  buildPortugueseRows,
  upsertPortugueseEmailRows,
} = require('./20260625120000_add_portuguese_email_templates.cjs');

exports.up = async function up(knex) {
  await upsertEmailCategoriesAndSubtypes(knex);
  const subtypes = await knex('notification_subtypes').select('id', 'name');
  const rows = buildPortugueseRows(subtypes);
  await upsertPortugueseEmailRows(knex, rows);
  console.log(`Refreshed ${rows.length} Brazilian Portuguese email templates.`);
};

exports.down = async function down() {
  // No-op: email template migrations are forward-only content corrections.
};

// Citus: notification_categories is a reference table, and knex otherwise runs
// the whole pending batch in one transaction — a parallel multi-shard operation
// from an earlier migration in that transaction makes this upsert error. The
// upserts are idempotent, so running outside a transaction is safe.
exports.config = { transaction: false };
