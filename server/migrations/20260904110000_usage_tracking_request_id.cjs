'use strict';

/**
 * Additive usage request-id retry protection (plan: contract quantity & usage
 * semantics, R4/F010).
 *
 * Dated additive consumption entries carry an optional caller-supplied request
 * id. A partial-unique index makes an identical replay recognizable: the same
 * request id can never create a second consumption event, while deliberate
 * separate events remain separate even when their date and quantity match.
 *
 * Non-billable rollout: existing rows get NULL and never reinterpreted.
 */

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('usage_tracking')) {
    if (!(await hasColumn(knex, 'usage_tracking', 'request_id'))) {
      await knex.raw(`
        ALTER TABLE usage_tracking
        ADD COLUMN request_id text
      `);
    }
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS usage_tracking_request_id_unique
      ON usage_tracking (tenant, request_id)
      WHERE request_id IS NOT NULL
    `);
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('usage_tracking')) {
    await knex.raw('DROP INDEX IF EXISTS usage_tracking_request_id_unique');
    if (await hasColumn(knex, 'usage_tracking', 'request_id')) {
      await knex.schema.alterTable('usage_tracking', (t) => {
        t.dropColumn('request_id');
      });
    }
  }
};

// ALTER TABLE on Citus-distributed tables must not run inside a transaction.
exports.config = { transaction: false };
