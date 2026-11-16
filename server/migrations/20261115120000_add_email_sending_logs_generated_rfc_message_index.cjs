/**
 * Index for the inbound generated-id fallback (alga0002306).
 *
 * Resend/SES replace the Message-ID we generate; the generated id is kept in
 * email_sending_logs.metadata.generatedRfcMessageId, and a customer's reply can still name it (it is in
 * References already sent). resolveReplyTargetFromOutboundMessageId looks it up with exactly the
 * expression indexed here, so the lookup is tenant-leading and never scans the tenant's log rows.
 *
 * Partial on "key is present": only rows where an on-wire id replaced ours are indexed. The predicate is
 * written with IS NOT NULL (not jsonb `?`) because metadata is a json column in some environments.
 * The query in processInboundEmailInApp.ts repeats the same predicate and expression; keep them in sync.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTenant = await knex.schema.hasColumn('email_sending_logs', 'tenant');
  const hasTenantId = await knex.schema.hasColumn('email_sending_logs', 'tenant_id');
  const tenantColumn = hasTenant ? 'tenant' : hasTenantId ? 'tenant_id' : null;

  if (!tenantColumn) {
    throw new Error('email_sending_logs is missing both tenant and tenant_id columns');
  }

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_email_sending_logs_tenant_generated_rfc_message
    ON email_sending_logs (${tenantColumn}, ((metadata->>'generatedRfcMessageId')))
    WHERE (metadata->>'generatedRfcMessageId') IS NOT NULL
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS idx_email_sending_logs_tenant_generated_rfc_message');
};

exports.config = { transaction: false };
