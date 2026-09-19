/**
 * Adds tenant reactivation / win-back state.
 *
 * - pending_tenant_deletions.last_winback_email_at stores the per-tenant login
 *   win-back throttle timestamp.
 * - pending_reactivation_refunds is the manual-refund work queue for captured
 *   reactivation payments that cannot or should not reactivate a tenant.
 * - tenant_reactivation_tokens is the durable single-use token ledger for
 *   reactivation email links.
 *
 * Both new tables are tenant-scoped and distributed by `tenant`, colocated with
 * `tenants`. Distributed tables require the distribution column in every primary
 * key and unique constraint, hence the composite (tenant, id) keys and the
 * (tenant, token_hash) uniqueness. create_distributed_table cannot run inside a
 * transaction, so this migration disables the wrapping transaction.
 */

exports.config = { transaction: false };

async function isCitusEnabled(knex) {
  const result = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled`,
  );
  return result.rows?.[0]?.enabled === true;
}

async function distributeTenantTable(knex, table) {
  if (!(await isCitusEnabled(knex))) {
    console.log(`Citus not enabled, skipping ${table} distribution`);
    return;
  }

  const isDistributed = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_dist_partition WHERE logicalrelid = '${table}'::regclass
     ) AS distributed`,
  );
  if (isDistributed.rows?.[0]?.distributed) {
    console.log(`${table} already distributed`);
    return;
  }

  console.log(`Distributing ${table}...`);
  await knex.raw(`SELECT create_distributed_table('${table}', 'tenant', colocate_with => 'tenants')`);
  console.log(`✓ Distributed ${table}`);
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasPendingDeletions = await knex.schema.hasTable('pending_tenant_deletions');

  if (hasPendingDeletions) {
    const hasLastWinbackEmailAt = await knex.schema.hasColumn(
      'pending_tenant_deletions',
      'last_winback_email_at',
    );

    if (!hasLastWinbackEmailAt) {
      await knex.schema.alterTable('pending_tenant_deletions', (table) => {
        table.timestamp('last_winback_email_at').nullable();
      });
    }
  }

  const hasPendingReactivationRefunds = await knex.schema.hasTable('pending_reactivation_refunds');
  if (!hasPendingReactivationRefunds) {
    await knex.schema.createTable('pending_reactivation_refunds', (table) => {
      table.uuid('refund_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.text('stripe_checkout_session_id').notNullable();
      table.text('stripe_payment_intent_id').nullable();
      table.text('stripe_subscription_external_id').nullable();
      table.text('reason').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('resolved_at').nullable();

      // Distribution column must lead the primary key on Citus.
      table.primary(['tenant', 'refund_id'], {
        constraintName: 'pending_reactivation_refunds_pk',
      });
      table.index(['tenant'], 'pending_reactivation_refunds_tenant_idx');
      table.index(['resolved_at'], 'pending_reactivation_refunds_resolved_at_idx');
    });
  }

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS pending_reactivation_refunds_open_queue_idx
      ON pending_reactivation_refunds (created_at)
      WHERE resolved_at IS NULL;
  `);

  await distributeTenantTable(knex, 'pending_reactivation_refunds');

  const hasTenantReactivationTokens = await knex.schema.hasTable('tenant_reactivation_tokens');
  if (!hasTenantReactivationTokens) {
    await knex.schema.createTable('tenant_reactivation_tokens', (table) => {
      table.uuid('reactivation_token_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('deletion_id').notNullable();
      table.text('token_hash').notNullable();
      table.timestamp('expires_at').notNullable();
      table.timestamp('reserved_at').nullable();
      table.timestamp('consumed_at').nullable();
      table.text('checkout_session_id').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      // Distribution column must lead the primary key and every unique
      // constraint on Citus. token_hash is HMAC-derived from a payload that
      // already includes the tenant id + a random nonce, so per-tenant
      // uniqueness is equivalent to global uniqueness in practice.
      table.primary(['tenant', 'reactivation_token_id'], {
        constraintName: 'tenant_reactivation_tokens_pk',
      });
      table.unique(['tenant', 'token_hash'], {
        indexName: 'tenant_reactivation_tokens_token_hash_uk',
      });
      table.index(['tenant', 'deletion_id'], 'tenant_reactivation_tokens_tenant_deletion_idx');
    });
  }

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS tenant_reactivation_tokens_open_unexpired_idx
      ON tenant_reactivation_tokens (tenant, deletion_id, expires_at)
      WHERE reserved_at IS NULL AND consumed_at IS NULL;
  `);

  await distributeTenantTable(knex, 'tenant_reactivation_tokens');
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS tenant_reactivation_tokens_open_unexpired_idx;');
  await knex.schema.dropTableIfExists('tenant_reactivation_tokens');

  await knex.schema.raw('DROP INDEX IF EXISTS pending_reactivation_refunds_open_queue_idx;');
  await knex.schema.dropTableIfExists('pending_reactivation_refunds');

  const hasPendingDeletions = await knex.schema.hasTable('pending_tenant_deletions');
  if (hasPendingDeletions) {
    const hasLastWinbackEmailAt = await knex.schema.hasColumn(
      'pending_tenant_deletions',
      'last_winback_email_at',
    );

    if (hasLastWinbackEmailAt) {
      await knex.schema.alterTable('pending_tenant_deletions', (table) => {
        table.dropColumn('last_winback_email_at');
      });
    }
  }
};
