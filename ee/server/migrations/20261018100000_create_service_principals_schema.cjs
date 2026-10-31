/**
 * Service principals (card C / F002, F003, F004, F006; PRD R1.3, R1.4, R5.5, R6.2, R9.1).
 *
 * EE-only schema for non-interactive identities (users.user_type = 'service'):
 *   - service_principals            one row per service user (metadata)
 *   - agents.service_user_id        binding from an MCP agent to its service user
 *   - via-principal columns         the principal a human-attributed write came through
 *   - mcp_agent_audit.act_as_user_id
 *   - tenants.service_principal_limit  nullable platform-admin override (hosted only)
 *
 * Relations are enforced in the application, not by DB constraints (house style).
 * Every statement is idempotent. No default uses now() inside CASE/COALESCE
 * (2026-10-13 Citus outage); the only defaults are plain column defaults.
 * Runs outside a transaction so the Citus DDL and distribution can be issued
 * statement by statement.
 */
exports.config = { transaction: false };

const VIA_COLUMNS = [
  ['time_entries', 'created_via_principal_id'],
  ['time_entries', 'updated_via_principal_id'],
  ['time_sheets', 'approved_via_principal_id'],
  ['schedule_entries', 'created_via_principal_id'],
  ['interactions', 'created_via_principal_id'],
  ['comments', 'created_via_principal_id'],
  ['tickets', 'entered_via_principal_id'],
  ['project_tasks', 'created_via_principal_id'],
  ['ticket_audit_logs', 'via_principal_user_id'],
  ['mcp_agent_audit', 'act_as_user_id'],
];

async function addNullableUuid(knex, table, column) {
  if (!(await knex.schema.hasTable(table))) return;
  if (await knex.schema.hasColumn(table, column)) return;
  await knex.schema.alterTable(table, (t) => {
    t.uuid(column).nullable();
  });
}

async function dropColumnIfPresent(knex, table, column) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) return;
  await knex.schema.alterTable(table, (t) => {
    t.dropColumn(column);
  });
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('service_principals'))) {
    await knex.schema.createTable('service_principals', (t) => {
      t.uuid('tenant').notNullable();
      t.uuid('user_id').notNullable();
      t.string('kind', 32).notNullable();
      t.string('name').notNullable();
      t.text('description').nullable();
      t.boolean('allow_act_as').notNullable().defaultTo(false);
      // Per-principal token-bucket override. Both null means "use the Pro default".
      t.integer('rate_limit_max_tokens').nullable();
      t.integer('rate_limit_refill_per_min').nullable();
      t.uuid('created_by').nullable();
      t.timestamp('archived_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.primary(['tenant', 'user_id']);
      t.index(['tenant', 'kind'], 'service_principals_tenant_kind_idx');
      t.check("kind IN ('api', 'mcp_agent')", [], 'service_principals_kind_check');
    });
  }

  await addNullableUuid(knex, 'agents', 'service_user_id');
  if (await knex.schema.hasTable('agents')) {
    await knex.raw(
      'CREATE INDEX IF NOT EXISTS agents_tenant_service_user_idx ON agents (tenant, service_user_id)'
    );
  }

  for (const [table, column] of VIA_COLUMNS) {
    await addNullableUuid(knex, table, column);
  }

  if (!(await knex.schema.hasColumn('tenants', 'service_principal_limit'))) {
    await knex.schema.alterTable('tenants', (t) => {
      t.integer('service_principal_limit').nullable();
    });
  }

  const citus = await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table') AS available"
  );
  if (citus.rows?.[0]?.available) {
    const state = await knex.raw(
      "SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'service_principals'::regclass) AS distributed"
    );
    if (!state.rows?.[0]?.distributed) {
      await knex.raw(
        "SELECT create_distributed_table('service_principals', 'tenant', colocate_with => 'tenants')"
      );
    }
  }
};

exports.down = async function down(knex) {
  // Dropping the table would silently discard principal metadata. Refuse when any
  // principal exists; the operator must archive and delete them first.
  if (await knex.schema.hasTable('service_principals')) {
    const { rows } = await knex.raw('SELECT count(*)::int AS n FROM service_principals');
    if (rows[0].n > 0) {
      throw new Error(
        `Cannot roll back service_principals: ${rows[0].n} principal(s) exist. Delete them before rolling back.`
      );
    }
  }
  await dropColumnIfPresent(knex, 'tenants', 'service_principal_limit');
  for (const [table, column] of VIA_COLUMNS) {
    await dropColumnIfPresent(knex, table, column);
  }
  await knex.raw('DROP INDEX IF EXISTS agents_tenant_service_user_idx');
  await dropColumnIfPresent(knex, 'agents', 'service_user_id');
  await knex.schema.dropTableIfExists('service_principals');
};
