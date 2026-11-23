'use strict';

/**
 * The ITIL SLA policy is found by a flag, not by its name — `ee/plans/2026-11-21-itil-remediation`
 * (F124, F125).
 *
 * `configureItilSlaForBoard` looked its policy up with `policy_name = 'ITIL Standard'`, so a tenant
 * that renamed it got a second one on the next ITIL board, and a tenant's own policy that happened
 * to carry that name was adopted (and swept by the ITIL cleanup). `sla_policies.is_itil_standard`
 * answers the question instead: the row this product created for ITIL priorities, at most one per
 * tenant.
 *
 * The flag is set on the existing row named 'ITIL Standard' — the only thing that identifies it
 * today. Where a tenant has several such rows, the oldest is the one the service would have found
 * (`first()` on an unordered query is not defined, but every write path created exactly one), so
 * the flag goes to the oldest and the others stay as the tenant's own policies.
 *
 * No policy is created, deleted or assigned to a board: D1 says no migration ever gives a board an
 * SLA it did not have.
 *
 * Citus: `transaction: false`, every statement tenant-pinned, values selected then written back as
 * parameters, and the unique index leads with `tenant`. No RLS policy on the column.
 *
 * Idempotent: a second run finds the flag already set and writes nothing.
 */

const { tenantDb } = require('./utils/tenantDb.cjs');

const ITIL_POLICY_NAME = 'ITIL Standard';
const UNIQUE_INDEX = 'sla_policies_tenant_itil_standard_unique';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('sla_policies'))) {
    return;
  }

  if (!(await knex.schema.hasColumn('sla_policies', 'is_itil_standard'))) {
    await knex.schema.alterTable('sla_policies', (table) => {
      table.boolean('is_itil_standard').notNullable().defaultTo(false);
    });
  }

  for (const tenant of await listTenants(knex)) {
    const db = tenantDb(knex, tenant);

    const alreadyFlagged = await db.table('sla_policies').where({ is_itil_standard: true }).first('sla_policy_id');
    if (alreadyFlagged) continue;

    const candidates = await db.table('sla_policies')
      .where({ policy_name: ITIL_POLICY_NAME })
      .orderBy('created_at', 'asc')
      .orderBy('sla_policy_id', 'asc')
      .select('sla_policy_id');
    if (candidates.length === 0) continue;

    // migration-lint: allow R5 - one row by primary key: the one policy this tenant's ITIL setup created
    await db.table('sla_policies')
      .where({ sla_policy_id: candidates[0].sla_policy_id })
      .update({ is_itil_standard: true });
  }

  // At most one per tenant. Partial, so the many unflagged policies are unaffected.
  // migration-lint: allow R1 - CONCURRENTLY cannot run here: sla_policies is tiny (one or two rows per tenant)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_INDEX}
    ON sla_policies (tenant)
    WHERE is_itil_standard = true
  `);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('sla_policies'))) {
    return;
  }

  await knex.raw(`DROP INDEX IF EXISTS ${UNIQUE_INDEX}`);

  if (await knex.schema.hasColumn('sla_policies', 'is_itil_standard')) {
    await knex.schema.alterTable('sla_policies', (table) => {
      table.dropColumn('is_itil_standard');
    });
  }
};

async function listTenants(knex) {
  if (!(await knex.schema.hasTable('tenants'))) return [];
  return knex('tenants').pluck('tenant');
}
