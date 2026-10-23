'use strict';

/** A standing discount belongs to one client-contract assignment, not a reusable template. */
exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable('contract_discount_assignments');
  if (!exists) return;
  if (!(await knex.schema.hasColumn('contract_discount_assignments', 'client_contract_id'))) {
    await knex.schema.alterTable('contract_discount_assignments', (table) => {
      table.uuid('client_contract_id').nullable();
    });
    // The old key permits only one row per contract/discount. Remove it before
    // expanding each attachment to concrete client-contract assignments; doing
    // the inserts first silently conflicts with the source row and then loses it.
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
    // Additional client-contract copies temporarily have no legacy contract
    // key. Make it nullable before inserting them; it is dropped after the
    // expansion below.
    await knex.schema.alterTable('contract_discount_assignments', (table) => {
      table.uuid('contract_id').nullable().alter();
    });
    const oldIndex = await knex.raw(`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'contract_discount_assignments' AND indexname LIKE '%assignments_contract%' LIMIT 1`);
    if (oldIndex.rows?.[0]?.indexname) await knex.raw('DROP INDEX ??', [oldIndex.rows[0].indexname]);

    // Reuse the original assignment UUID for the first client contract so any
    // settlement keyed by it remains attributable. Additional client contracts
    // get distinct UUIDs and therefore independent settlement identities.
    const { rows: oldAssignments } = await knex.raw(`
      SELECT tenant, assignment_id, contract_id, discount_id, created_at
      FROM contract_discount_assignments
      WHERE client_contract_id IS NULL
      ORDER BY tenant, contract_id, discount_id, assignment_id
    `);
    for (const assignment of oldAssignments) {
      const { rows: clients } = await knex.raw(`
        SELECT client_contract_id
        FROM client_contracts
        WHERE tenant = ? AND contract_id = ?
        ORDER BY client_contract_id
      `, [assignment.tenant, assignment.contract_id]);
      if (clients.length === 0) {
        // The old foreign key normally cascades this case. Retain no dangling
        // attachment when upgrading databases where that FK was absent.
        await knex('contract_discount_assignments')
          .where({ tenant: assignment.tenant, assignment_id: assignment.assignment_id })
          .delete();
        continue;
      }
      await knex('contract_discount_assignments')
        .where({ tenant: assignment.tenant, assignment_id: assignment.assignment_id })
        .update({ client_contract_id: clients[0].client_contract_id });
      for (const client of clients.slice(1)) {
        await knex('contract_discount_assignments').insert({
          tenant: assignment.tenant,
          assignment_id: knex.raw('gen_random_uuid()'),
          contract_id: null,
          discount_id: assignment.discount_id,
          created_at: assignment.created_at,
          client_contract_id: client.client_contract_id,
        });
      }
    }
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
