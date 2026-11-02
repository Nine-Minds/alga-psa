const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');
const OBLIGATIONS = 'sla_organization_obligations', EVENTS = 'sla_organization_events';
exports.up = async function(knex) {
  if (!await knex.schema.hasTable(OBLIGATIONS)) await knex.schema.createTable(OBLIGATIONS, table => {
    table.uuid('tenant').notNullable(); // Policy owner; never the foreign ticket owner.
    table.uuid('obligation_id').notNullable();
    table.uuid('source_tenant').notNullable();
    table.uuid('ticket_id').notNullable();
    table.uuid('work_id').notNullable();
    table.integer('generation').notNullable();
    // Historical snapshots survive deletion of the original policy and priority.
    table.uuid('sla_policy_id').notNullable();
    table.uuid('priority_id').notNullable();
    table.integer('revision').notNullable();
    table.jsonb('clock').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();
    table.primary(['tenant', 'obligation_id']);
    table.unique(['tenant', 'source_tenant', 'ticket_id', 'work_id', 'generation']);
    table.check('generation > 0 AND revision > 0');
    table.check(`(clock #>> '{identity,tenant}' = tenant::text AND clock #>> '{identity,obligationId}' = obligation_id::text
      AND clock #>> '{identity,sourceTenant}' = source_tenant::text AND clock #>> '{identity,ticketId}' = ticket_id::text) IS TRUE`);
  });
  if (!await knex.schema.hasTable(EVENTS)) await knex.schema.createTable(EVENTS, table => {
    table.uuid('tenant').notNullable();
    table.uuid('obligation_id').notNullable();
    table.uuid('operation_id').notNullable();
    table.integer('revision').notNullable();
    table.text('event_type').notNullable();
    table.text('request_fingerprint').notNullable();
    table.jsonb('event').notNullable();
    table.timestamp('occurred_at', { useTz: true }).notNullable();
    table.primary(['tenant', 'obligation_id', 'operation_id']);
    table.unique(['tenant', 'obligation_id', 'revision']);
    table.check('revision > 0');
    table.check("event_type IN ('started', 'observed', 'paused', 'resumed', 'responded', 'resolved')");
    table.check("request_fingerprint ~ '^[0-9a-f]{64}$'");
  });
  for (const table of [OBLIGATIONS, EVENTS]) await ensureTenantDistribution(knex, table);
  // At most one unresolved obligation per (policy owner, source ticket). A duplicate or redelivered
  // escalation can therefore never start a second clock; the unique index leads with the
  // distribution column (Citus) and the table is new and empty, so a plain CREATE is safe.
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS sla_org_obligation_one_active_uq
    ON ${OBLIGATIONS} (tenant, source_tenant, ticket_id) WHERE (clock #>> '{resolution,completedAt}') IS NULL`);
  await ensureCompositeFk(knex, { table: OBLIGATIONS, constraint: 'sla_org_obligation_owner_fk', columns: ['tenant'],
    referencedTable: 'tenants', referencedColumns: ['tenant'], onDelete: 'CASCADE' });
  await ensureCompositeFk(knex, { table: EVENTS, constraint: 'sla_org_event_obligation_fk', columns: ['tenant', 'obligation_id'],
    referencedTable: OBLIGATIONS, referencedColumns: ['tenant', 'obligation_id'], onDelete: 'CASCADE' });
};
exports.down = async function(knex) {
  await knex.raw('DROP INDEX IF EXISTS sla_org_obligation_one_active_uq');
  for (const table of [EVENTS, OBLIGATIONS]) if (await knex(table).first()) throw new Error('Cannot remove retained organization SLA history');
  await knex.schema.dropTable(EVENTS);
  await knex.schema.dropTable(OBLIGATIONS);
};
exports.config = { transaction: false };
