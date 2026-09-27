'use strict';

/** A standing discount belongs to one client-contract assignment, not a reusable template. */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('contract_discount_assignments');
  if (!exists) return;
  if (!(await knex.schema.hasColumn('contract_discount_assignments', 'client_contract_id'))) {
    await knex.schema.alterTable('contract_discount_assignments', (table) => {
      table.uuid('client_contract_id').nullable();
    });
    // Preserve an existing contract-level attachment for each concrete client assignment.
    await knex.raw(`
      INSERT INTO contract_discount_assignments (tenant, assignment_id, contract_id, discount_id, created_at, client_contract_id)
      SELECT a.tenant, gen_random_uuid(), a.contract_id, a.discount_id, a.created_at, cc.client_contract_id
      FROM contract_discount_assignments a
      JOIN client_contracts cc ON cc.tenant = a.tenant AND cc.contract_id = a.contract_id
      WHERE a.client_contract_id IS NULL
      ON CONFLICT DO NOTHING
    `);
    await knex.raw(`DELETE FROM contract_discount_assignments WHERE client_contract_id IS NULL`);
    const oldUnique = await knex.raw(`
      SELECT c.conname FROM pg_constraint c
      WHERE c.conrelid = 'contract_discount_assignments'::regclass AND c.contype = 'u'
        AND (SELECT array_agg(a.attname ORDER BY a.attname)
             FROM unnest(c.conkey) AS key(attnum)
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum)
            = ARRAY['contract_id', 'discount_id', 'tenant']::name[]
      LIMIT 1
    `);
    if (oldUnique.rows?.[0]?.conname) {
      await knex.raw('ALTER TABLE contract_discount_assignments DROP CONSTRAINT ??', [oldUnique.rows[0].conname]);
    }
    const oldIndex = await knex.raw(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'contract_discount_assignments' AND indexname LIKE '%assignments_contract%' LIMIT 1`);
    if (oldIndex.rows?.[0]?.indexname) await knex.raw('DROP INDEX ??', [oldIndex.rows[0].indexname]);
    await knex.schema.alterTable('contract_discount_assignments', (table) => {
      table.dropForeign(['tenant', 'contract_id']);
      table.dropColumn('contract_id');
      table.uuid('client_contract_id').notNullable().alter();
      table.foreign(['tenant', 'client_contract_id']).references(['tenant', 'client_contract_id']).inTable('client_contracts').onDelete('CASCADE');
      table.unique(['tenant', 'client_contract_id', 'discount_id'], 'uq_contract_discount_assignments_client_contract');
      table.index(['tenant', 'client_contract_id'], 'idx_contract_discount_assignments_client_contract');
    });
  }

  const citus = await knex.raw("SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS present");
  if (citus.rows?.[0]?.present) {
    const distributed = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'public.contract_discount_assignments'::regclass) AS present");
    if (!distributed.rows?.[0]?.present) {
      await knex.raw("SELECT create_distributed_table('contract_discount_assignments', 'tenant', colocate_with => 'client_contracts')");
    }
  }
};

exports.down = async function down(knex) {
  // Restoring a contract-level attachment from per-client rows is lossy; keep the safer assignment model.
};
