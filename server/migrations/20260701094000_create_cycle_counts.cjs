/**
 * Cycle counts (remediation plan F059/F060): per-location stock-take sessions.
 *
 * count_sessions snapshot expected on-hand at start; counts are BLIND (expected is
 * withheld from counters — only holders of cycle_count:approve see it); approval
 * writes ordinary 'adjust' movements with reason 'cycle_count', so the movement
 * ledger stays the single source of truth (no parallel adjustment pathway).
 *
 * Permissions: cycle_count create/read/update/delete + the extra 'approve' action
 * that gates variance visibility and applying adjustments (counter ≠ approver is
 * policy, not schema).
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const RESOURCE = 'cycle_count';
const ACTIONS = ['create', 'read', 'update', 'delete', 'approve'];

exports.up = async function up(knex) {
  await knex.schema.createTable('count_sessions', (t) => {
    t.uuid('tenant').notNullable();
    t.uuid('session_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('location_id').notNullable();
    t.text('status').notNullable().defaultTo('in_progress');
    t.uuid('created_by').nullable();
    t.uuid('approved_by').nullable();
    t.timestamp('started_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('submitted_at').nullable();
    t.timestamp('approved_at').nullable();
    t.text('notes').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.primary(['tenant', 'session_id']);
    t.foreign(['tenant', 'location_id'], 'fk_count_sessions_location')
      .references(['tenant', 'location_id'])
      .inTable('stock_locations');
    t.index(['tenant', 'location_id'], 'idx_count_sessions_location');
    t.index(['tenant', 'status'], 'idx_count_sessions_status');
  });
  await knex.raw(`
    ALTER TABLE count_sessions ADD CONSTRAINT count_sessions_status_check
      CHECK (status = ANY (ARRAY['draft'::text, 'in_progress'::text, 'review'::text, 'approved'::text, 'cancelled'::text]))
  `);

  await knex.schema.createTable('count_lines', (t) => {
    t.uuid('tenant').notNullable();
    t.uuid('count_line_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('session_id').notNullable();
    t.uuid('service_id').notNullable();
    t.integer('expected_qty').notNullable().defaultTo(0); // snapshot at start
    t.jsonb('expected_serials').nullable(); // serialized: in_stock serials at start
    t.integer('counted_qty').nullable(); // null = not yet counted
    t.jsonb('counted_serials').nullable();
    t.timestamp('counted_at').nullable();
    t.uuid('counted_by').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    t.primary(['tenant', 'count_line_id']);
    t.unique(['tenant', 'session_id', 'service_id'], { indexName: 'uq_count_lines_session_service' });
    t.foreign(['tenant', 'session_id'], 'fk_count_lines_session')
      .references(['tenant', 'session_id'])
      .inTable('count_sessions')
      .onDelete('CASCADE');
    t.foreign(['tenant', 'service_id'], 'fk_count_lines_service')
      .references(['tenant', 'service_id'])
      .inTable('service_catalog');
  });

  // Distribute on Citus (colocated with tenants); sessions before lines.
  await ensureTenantDistribution(knex, 'count_sessions');
  await ensureTenantDistribution(knex, 'count_lines');

  // Permissions (pattern of 20260626100600_add_inventory_permissions.cjs).
  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    const existing = await knex('permissions').where({ tenant, resource: RESOURCE }).select('action');
    const have = new Set(existing.map((p) => p.action));
    const toAdd = ACTIONS.filter((a) => !have.has(a)).map((action) => ({
      tenant,
      permission_id: knex.raw('gen_random_uuid()'),
      resource: RESOURCE,
      action,
      msp: true,
      client: false,
      description: `${action} ${RESOURCE}`,
      created_at: new Date(),
    }));
    if (toAdd.length > 0) await knex('permissions').insert(toAdd);

    const adminRole = await knex('roles')
      .where({ tenant, msp: true, client: false })
      .whereRaw("LOWER(role_name) = 'admin'")
      .first();
    if (adminRole) {
      const perms = await knex('permissions')
        .where({ tenant, msp: true, resource: RESOURCE })
        .select('permission_id');
      const existingRolePerms = await knex('role_permissions')
        .where({ tenant, role_id: adminRole.role_id })
        .select('permission_id');
      const haveRole = new Set(existingRolePerms.map((rp) => rp.permission_id));
      const rolePerms = perms
        .filter((p) => !haveRole.has(p.permission_id))
        .map((p) => ({ tenant, role_id: adminRole.role_id, permission_id: p.permission_id }));
      if (rolePerms.length > 0) await knex('role_permissions').insert(rolePerms);
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');
  for (const { tenant } of tenants) {
    await knex('role_permissions')
      .where('tenant', tenant)
      .whereIn('permission_id', function () {
        this.select('permission_id').from('permissions').where({ tenant, resource: RESOURCE });
      })
      .delete();
    await knex('permissions').where({ tenant, resource: RESOURCE }).delete();
  }
  await knex.schema.dropTableIfExists('count_lines');
  await knex.schema.dropTableIfExists('count_sessions');
};

exports.config = { transaction: false };
