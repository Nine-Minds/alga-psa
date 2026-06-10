/**
 * Create inbound_email_rules table.
 *
 * Tenant-wide ordered rules evaluated on the inbound-email new-ticket path.
 * Each rule carries ALL-of conditions (JSONB), one action (skip,
 * extract_assign_client, set_destination, ai_classify) and a non-match
 * behavior. provider_ids (JSONB array) optionally restricts the rule to
 * specific email providers; NULL applies to all mailboxes.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('inbound_email_rules');
  if (!hasTable) {
    await knex.schema.createTable('inbound_email_rules', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));

      table.text('name').notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.integer('position').notNullable();
      table.jsonb('provider_ids').nullable();
      table.jsonb('conditions').notNullable();
      table.text('action_type').notNullable();
      table.jsonb('action_config').notNullable().defaultTo('{}');
      table.text('on_no_match').notNullable().defaultTo('proceed');
      table.uuid('fallback_inbound_ticket_defaults_id').nullable();

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'id']);

      table.check(
        "action_type IN ('skip', 'extract_assign_client', 'set_destination', 'ai_classify')",
        [],
        'inbound_email_rules_action_type_check'
      );
      table.check(
        "on_no_match IN ('proceed', 'fallback_destination', 'skip')",
        [],
        'inbound_email_rules_on_no_match_check'
      );
    });
  }

  // Evaluation-order lookup: active rules for a tenant in position order.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS inbound_email_rules_tenant_position_idx
    ON inbound_email_rules (tenant, position)
  `);

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'inbound_email_rules'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      // create_distributed_table is not allowed inside a transaction in some Citus configs.
      await knex.raw("SELECT create_distributed_table('inbound_email_rules', 'tenant')");
    }
  } else {
    console.warn('[create_inbound_email_rules] Skipping create_distributed_table (function unavailable)');
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('inbound_email_rules');
};

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };
