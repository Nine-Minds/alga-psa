/**
 * Migration: create accounting sync engine tables — per-realm cycle history
 * (with the change-polling cursor) and the outbound operation queue drained
 * by the scheduled sync cycle.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasCycles = await knex.schema.hasTable('accounting_sync_cycles');
  if (!hasCycles) {
    await knex.schema.createTable('accounting_sync_cycles', (table) => {
      table.uuid('cycle_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.string('adapter_type', 50).notNullable();
      table.string('target_realm', 255).notNullable();
      table.string('status', 30).notNullable().defaultTo('running'); // running | succeeded | failed | aborted
      table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('finished_at', { useTz: true }).nullable();
      table.timestamp('cursor_before', { useTz: true }).nullable();
      table.timestamp('cursor_after', { useTz: true }).nullable();
      table.jsonb('stats').nullable();
      table.text('error').nullable();

      table.primary(['tenant', 'cycle_id']);
      table.index(['tenant', 'adapter_type', 'target_realm', 'started_at'], 'accounting_sync_cycles_realm_started_idx');
      table.index(['tenant', 'status'], 'accounting_sync_cycles_tenant_status_idx');
    });
  }

  const hasOps = await knex.schema.hasTable('accounting_sync_operations');
  if (!hasOps) {
    await knex.schema.createTable('accounting_sync_operations', (table) => {
      table.uuid('op_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.string('adapter_type', 50).notNullable();
      table.string('target_realm', 255).nullable();
      table.string('operation', 50).notNullable(); // export_invoice | export_credit_memo | apply_credit | record_payment | void_invoice
      table.string('alga_entity_type', 50).notNullable();
      table.uuid('alga_entity_id').notNullable();
      table.string('status', 30).notNullable().defaultTo('pending'); // pending | in_progress | done | failed | skipped
      table.integer('attempts').notNullable().defaultTo(0);
      table.text('last_error').nullable();
      table.jsonb('payload').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('processed_at', { useTz: true }).nullable();

      table.primary(['tenant', 'op_id']);
      table.index(['tenant', 'adapter_type', 'status'], 'accounting_sync_operations_adapter_status_idx');
      table.index(['tenant', 'alga_entity_type', 'alga_entity_id'], 'accounting_sync_operations_entity_idx');
      table.index(['tenant', 'operation', 'status'], 'accounting_sync_operations_op_status_idx');
    });
  }

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  const citusAvailable = citusFn.rows?.[0]?.exists ?? citusFn[0]?.exists ?? false;

  if (citusAvailable) {
    await distributeTable(knex, 'accounting_sync_cycles');
    await distributeTable(knex, 'accounting_sync_operations');
  } else {
    console.warn('[accounting_sync_tables] Skipping create_distributed_table calls (function unavailable)');
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('accounting_sync_operations');
  await knex.schema.dropTableIfExists('accounting_sync_cycles');
};

async function distributeTable(knex, tableName) {
  await knex.raw(`
    DO $distribution$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) THEN
        PERFORM create_distributed_table('${tableName}', 'tenant');
      END IF;
    END;
    $distribution$;
  `);
}

exports.config = { transaction: false };
