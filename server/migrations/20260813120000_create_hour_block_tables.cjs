/**
 * Ad-hoc prepaid hour blocks: schema (2026-08-13)
 *
 * Implements the data model from
 * docs/plans/2026-08-13-ad-hoc-prepaid-hour-blocks-plan.md — a client-level,
 * minutes-denominated ledger for one-time prepaid hour blocks (non-recurring,
 * stackable, FIFO by expiration-then-purchase, optional expiration). Distinct
 * from contract/bucket machinery: blocks are NOT period-bound and never reset.
 *
 *  - hour_blocks                   the block itself (purchase size, draw-down
 *                                  balance, status, purchase provenance)
 *  - hour_block_service_scopes     optional service scoping (empty = all labor)
 *  - hour_block_time_allocations   the burn ledger: which entry drew how many
 *                                  minutes from which block (source of truth for
 *                                  reconcile, invoice info lines, burn history,
 *                                  and the "has any burn" void check)
 *  - hour_block_audit              lifecycle audit rows (purchase/grant/adjust/
 *                                  expiration/void). Burns live ONLY in
 *                                  allocations — never duplicated here.
 *
 * All tables are tenant-scoped with composite (tenant, id) primary keys and
 * Citus distribution by tenant, following the current house pattern
 * (ticket_audit_logs, ticket close-rule tables). Like every table created
 * since 2025, RLS is deliberately NOT enabled: the application connection
 * layer does not set the `app.current_tenant` GUC (knexfile comments state
 * "CitusDB handles isolation automatically at the shard level"), so the old
 * 2024 tenant_isolation_policy pattern would make every query against these
 * tables fail with an unset current_setting. Tenant isolation is enforced by
 * the composite tenant PKs and the tenantDb query layer instead.
 */

// Helper: distribute a table by tenant if Citus is available.
// Colocation with invoices is required so the composite FKs to invoices /
// clients / service_catalog / time_entries / each other are valid on Citus
// (FKs between distributed tables demand the same colocation group; see
// 20260722120000_create_invoice_payments_table.cjs).
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);
  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);
    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(
        `SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => 'invoices')`,
        [tableName],
      );
    }
  }
}

// Helper: add a composite FK only if it doesn't already exist
async function addForeignKeyIfMissing(knex, constraintName, sql) {
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}'
      ) THEN
        ${sql};
      END IF;
    END $$;
  `);
}

// Helper: whether Citus manages a table at all (distributed, reference, or
// citus-local). Absent from pg_dist_partition = plain coordinator-local table.
async function isManagedByCitus(knex, tableName) {
  try {
    const managed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_managed;
    `);
    return Boolean(managed.rows?.[0]?.is_managed);
  } catch (error) {
    return false;
  }
}

// Helper: whether a table is distributed on a live Citus deployment
async function isDistributedOnCitus(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);
  if (!citusFn.rows?.[0]?.exists) {
    return false;
  }
  return isManagedByCitus(knex, tableName);
}

exports.up = async function (knex) {
  // --- hour_blocks --------------------------------------------------------
  if (!(await knex.schema.hasTable('hour_blocks'))) {
    await knex.schema.createTable('hour_blocks', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('block_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('client_id').notNullable()
        .comment('Owning client.');
      table.uuid('service_id').notNullable()
        .comment('Catalog service the block is sold as (tax/GL/invoice description) — distinct from burn scope.');
      table.integer('total_minutes').notNullable()
        .comment('Purchased size in minutes.');
      table.integer('remaining_minutes').notNullable()
        .comment('Draw-down balance; maintained transactionally (credit remaining_amount analog).');
      table.integer('hourly_rate').notNullable()
        .comment('Cents per hour agreed at purchase.');
      table.integer('purchase_amount').notNullable().defaultTo(0)
        .comment('Cents; hours × hourly_rate at creation (0 for grants unless a value is recorded).');
      table.string('currency_code').notNullable().defaultTo('USD');
      table.string('status', 16).notNullable().defaultTo('pending')
        .comment("pending | active | expired | voided. Exhausted is derived (remaining_minutes = 0), not a status.");
      table.timestamp('purchased_at', { useTz: true }).nullable()
        .comment('Set on activation (invoice finalize / grant).');
      table.date('expiration_date').nullable();
      table.uuid('source_invoice_id').nullable()
        .comment('Null ⇒ direct grant.');
      table.timestamp('voided_at', { useTz: true }).nullable();
      table.uuid('voided_by').nullable();
      table.text('void_reason').nullable();
      table.uuid('created_by').nullable();
      table.text('notes').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'block_id']);
      table.index(['tenant', 'client_id', 'status'], 'hour_blocks_client_status_idx');
      table.index(['tenant', 'expiration_date'], 'hour_blocks_expiration_idx');
    });

    await knex.raw(`
      ALTER TABLE hour_blocks
      ADD CONSTRAINT hour_blocks_status_check
      CHECK (status IN ('pending', 'active', 'expired', 'voided'))
    `);
    await knex.raw(`
      ALTER TABLE hour_blocks
      ADD CONSTRAINT hour_blocks_remaining_nonnegative_check
      CHECK (remaining_minutes >= 0)
    `);
    await knex.raw(`
      ALTER TABLE hour_blocks
      ADD CONSTRAINT hour_blocks_total_positive_check
      CHECK (total_minutes > 0)
    `);
  }

  // --- hour_block_service_scopes ------------------------------------------
  if (!(await knex.schema.hasTable('hour_block_service_scopes'))) {
    await knex.schema.createTable('hour_block_service_scopes', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('block_id').notNullable();
      table.uuid('service_id').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'block_id', 'service_id']);
    });
  }

  // --- hour_block_time_allocations -----------------------------------------
  if (!(await knex.schema.hasTable('hour_block_time_allocations'))) {
    await knex.schema.createTable('hour_block_time_allocations', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('allocation_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('block_id').notNullable();
      table.uuid('time_entry_id').notNullable();
      table.integer('minutes').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'allocation_id']);
      table.unique(['tenant', 'block_id', 'time_entry_id'], 'hour_block_allocations_block_entry_uq');
      table.index(['tenant', 'time_entry_id'], 'hour_block_allocations_entry_idx');
      table.index(['tenant', 'block_id'], 'hour_block_allocations_block_idx');
    });
  }

  // --- hour_block_audit -----------------------------------------------------
  if (!(await knex.schema.hasTable('hour_block_audit'))) {
    await knex.schema.createTable('hour_block_audit', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('audit_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('block_id').notNullable();
      table.string('type', 32).notNullable()
        .comment('purchase | grant | adjustment | expiration_date_change | manual_expiration | auto_expiration | void');
      table.integer('minutes_delta').nullable();
      table.text('reason').nullable();
      table.uuid('created_by').nullable();
      table.jsonb('metadata').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'audit_id']);
      table.index(['tenant', 'block_id'], 'hour_block_audit_block_idx');
    });

    await knex.raw(`
      ALTER TABLE hour_block_audit
      ADD CONSTRAINT hour_block_audit_type_check
      CHECK (type IN ('purchase', 'grant', 'adjustment', 'expiration_date_change',
                      'manual_expiration', 'auto_expiration', 'void'))
    `);
  }

  // Distribute before FKs — Citus requires both sides distributed first.
  await distributeIfCitus(knex, 'hour_blocks');
  await distributeIfCitus(knex, 'hour_block_service_scopes');
  await distributeIfCitus(knex, 'hour_block_time_allocations');
  await distributeIfCitus(knex, 'hour_block_audit');

  await addForeignKeyIfMissing(knex, 'hour_blocks_client_fkey', `
    ALTER TABLE hour_blocks
      ADD CONSTRAINT hour_blocks_client_fkey
      FOREIGN KEY (tenant, client_id)
      REFERENCES clients(tenant, client_id)
      ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'hour_blocks_service_fkey', `
    ALTER TABLE hour_blocks
      ADD CONSTRAINT hour_blocks_service_fkey
      FOREIGN KEY (tenant, service_id)
      REFERENCES service_catalog(tenant, service_id)
  `);
  // A bare ON DELETE SET NULL on this composite FK would null the tenant
  // column too, stripping tenancy from the block row (see the
  // users_tenant_contact_id_foreign precedent); PG 15+ supports nulling only
  // source_invoice_id. Citus additionally forbids SET NULL outright on FKs
  // that include the distribution key, so the backstop degrades to a plain
  // FK there. Every application path already nulls source_invoice_id before
  // the purchase invoice is deleted (see
  // voidPendingHourBlocksForInvoiceDeletion in
  // packages/billing/src/actions/invoiceModification.ts), so the action is
  // only a plain-Postgres backstop.
  const hourBlocksDistributed = await isDistributedOnCitus(knex, 'hour_blocks');
  const pgVersion = parseInt(
    (await knex.raw("SELECT current_setting('server_version_num')::int AS v")).rows[0].v,
    10,
  );
  const invoiceFkeyOnDelete = hourBlocksDistributed
    ? ''
    : (pgVersion >= 150000 ? 'ON DELETE SET NULL (source_invoice_id)' : 'ON DELETE SET NULL');
  await addForeignKeyIfMissing(knex, 'hour_blocks_invoice_fkey', `
    ALTER TABLE hour_blocks
      ADD CONSTRAINT hour_blocks_invoice_fkey
      FOREIGN KEY (tenant, source_invoice_id)
      REFERENCES invoices(tenant, invoice_id)
      ${invoiceFkeyOnDelete}
  `);

  await addForeignKeyIfMissing(knex, 'hour_block_scopes_block_fkey', `
    ALTER TABLE hour_block_service_scopes
      ADD CONSTRAINT hour_block_scopes_block_fkey
      FOREIGN KEY (tenant, block_id)
      REFERENCES hour_blocks(tenant, block_id)
      ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'hour_block_scopes_service_fkey', `
    ALTER TABLE hour_block_service_scopes
      ADD CONSTRAINT hour_block_scopes_service_fkey
      FOREIGN KEY (tenant, service_id)
      REFERENCES service_catalog(tenant, service_id)
  `);

  await addForeignKeyIfMissing(knex, 'hour_block_allocations_block_fkey', `
    ALTER TABLE hour_block_time_allocations
      ADD CONSTRAINT hour_block_allocations_block_fkey
      FOREIGN KEY (tenant, block_id)
      REFERENCES hour_blocks(tenant, block_id)
      ON DELETE CASCADE
  `);
  // Citus: time_entries stays a coordinator-local table (no migration ever
  // distributes it), and a distributed table cannot hold a FK to a local one.
  // Degrade to a soft reference there — the same discipline
  // time_entry_change_requests uses — because every edit/delete path reverses
  // the entry's allocations in-transaction (see reverseTimeEntryAllocations).
  const allocationsDistributed = await isDistributedOnCitus(knex, 'hour_block_time_allocations');
  const timeEntriesCitusManaged = await isManagedByCitus(knex, 'time_entries');
  if (!allocationsDistributed || timeEntriesCitusManaged) {
    await addForeignKeyIfMissing(knex, 'hour_block_allocations_entry_fkey', `
      ALTER TABLE hour_block_time_allocations
        ADD CONSTRAINT hour_block_allocations_entry_fkey
        FOREIGN KEY (tenant, time_entry_id)
        REFERENCES time_entries(tenant, entry_id)
        ON DELETE CASCADE
    `);
  }

  await addForeignKeyIfMissing(knex, 'hour_block_audit_block_fkey', `
    ALTER TABLE hour_block_audit
      ADD CONSTRAINT hour_block_audit_block_fkey
      FOREIGN KEY (tenant, block_id)
      REFERENCES hour_blocks(tenant, block_id)
      ON DELETE CASCADE
  `);
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('hour_block_audit');
  await knex.schema.dropTableIfExists('hour_block_time_allocations');
  await knex.schema.dropTableIfExists('hour_block_service_scopes');
  await knex.schema.dropTableIfExists('hour_blocks');
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };
