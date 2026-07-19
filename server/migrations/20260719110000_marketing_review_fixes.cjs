async function hasCitus(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS available
  `);
  return Boolean(result.rows?.[0]?.available);
}

/**
 * Marketing module code-review fixes (data layer):
 *
 * - B2: idempotent send log `marketing_sequence_sends` — at most one delivery
 *   per (tenant, enrollment, step); claims persist inside the send loop's
 *   claim transaction.
 * - M12: enrollments -> contacts FK becomes ON DELETE CASCADE so deleting a
 *   once-enrolled contact succeeds (the durable record is the email-keyed
 *   suppression row).
 * - N4: partial unique index — at most one active enrollment per
 *   (tenant, sequence, contact).
 * - N5: CHECK (email = lower(email)) on suppressions so the existing
 *   (tenant, email) unique index structurally enforces case-insensitive
 *   uniqueness.
 * - N6: index for the sequence step-stats query.
 * - N7: sequences gain an optional campaign link so sequence engagements can
 *   carry campaign attribution into the funnel.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  // B2 — idempotent send log.
  await knex.schema.createTable('marketing_sequence_sends', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('send_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('enrollment_id').notNullable();
    table.uuid('step_id').notNullable();
    table.text('status').notNullable().defaultTo('claimed');
    table.text('error').nullable();
    table.timestamp('claimed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('sent_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'send_id']);
  });

  await knex.raw(`
    ALTER TABLE marketing_sequence_sends
    ADD CONSTRAINT marketing_sequence_sends_status_check
    CHECK (status IN ('claimed', 'sent', 'failed'))
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_marketing_sequence_sends_tenant_enrollment_step
    ON marketing_sequence_sends (tenant, enrollment_id, step_id)
  `);

  // Citus requires distribution before cross-table FKs; no-op on plain pg.
  if (await hasCitus(knex)) {
    await knex.raw(
      `SELECT create_distributed_table('marketing_sequence_sends'::regclass, 'tenant', colocate_with => 'tenants')`,
    );
  }

  await knex.schema.alterTable('marketing_sequence_sends', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'enrollment_id']).references(['tenant', 'enrollment_id']).inTable('marketing_sequence_enrollments').onDelete('CASCADE');
    table.foreign(['tenant', 'step_id']).references(['tenant', 'step_id']).inTable('marketing_sequence_steps').onDelete('CASCADE');
  });

  // M12 — enrollments cascade away with their contact.
  await knex.schema.alterTable('marketing_sequence_enrollments', (table) => {
    table.dropForeign(['tenant', 'contact_id']);
    table.foreign(['tenant', 'contact_id']).references(['tenant', 'contact_name_id']).inTable('contacts').onDelete('CASCADE');
  });

  // N4 — one active enrollment per (tenant, sequence, contact).
  await knex.raw(`
    CREATE UNIQUE INDEX idx_marketing_sequence_enrollments_active_unique
    ON marketing_sequence_enrollments (tenant, sequence_id, contact_id)
    WHERE state = 'active'
  `);

  // N5 — make lowercase structural, not just a code convention.
  await knex.raw(`UPDATE marketing_suppressions SET email = lower(email) WHERE email <> lower(email)`);
  await knex.raw(`
    ALTER TABLE marketing_suppressions
    ADD CONSTRAINT marketing_suppressions_email_lowercase_check
    CHECK (email = lower(email))
  `);

  // N6 — step-stats query support.
  await knex.raw(`
    CREATE INDEX idx_marketing_engagements_tenant_step
    ON marketing_engagements (tenant, step_id)
  `);

  // N7 — sequences can belong to a campaign.
  await knex.schema.alterTable('marketing_sequences', (table) => {
    table.uuid('campaign_id').nullable();
    table.foreign(['tenant', 'campaign_id']).references(['tenant', 'campaign_id']).inTable('marketing_campaigns').onDelete('SET NULL');
  });
  await knex.raw(`
    CREATE INDEX idx_marketing_sequences_tenant_campaign
    ON marketing_sequences (tenant, campaign_id)
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_marketing_sequences_tenant_campaign`);
  await knex.schema.alterTable('marketing_sequences', (table) => {
    table.dropForeign(['tenant', 'campaign_id']);
    table.dropColumn('campaign_id');
  });
  await knex.raw(`DROP INDEX IF EXISTS idx_marketing_engagements_tenant_step`);
  await knex.raw(`ALTER TABLE marketing_suppressions DROP CONSTRAINT IF EXISTS marketing_suppressions_email_lowercase_check`);
  await knex.raw(`DROP INDEX IF EXISTS idx_marketing_sequence_enrollments_active_unique`);
  await knex.schema.alterTable('marketing_sequence_enrollments', (table) => {
    table.dropForeign(['tenant', 'contact_id']);
    table.foreign(['tenant', 'contact_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
  });
  await knex.schema.dropTableIfExists('marketing_sequence_sends');
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
