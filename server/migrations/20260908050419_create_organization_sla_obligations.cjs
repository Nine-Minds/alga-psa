const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
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
  for (const [table, name, columns, parent, parentColumns] of [
    [OBLIGATIONS, 'sla_org_obligation_owner_fk', ['tenant'], 'tenants', ['tenant']],
    [EVENTS, 'sla_org_event_obligation_fk', ['tenant', 'obligation_id'], OBLIGATIONS, ['tenant', 'obligation_id']],
  ]) if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [table]).first()) {
    await knex.schema.alterTable(table, builder => builder.foreign(columns, name).references(parentColumns).inTable(parent).onDelete('CASCADE'));
  }
};
exports.down = async function(knex) {
  for (const table of [EVENTS, OBLIGATIONS]) if (await knex(table).first()) throw new Error('Cannot remove retained organization SLA history');
  await knex.schema.dropTable(EVENTS);
  await knex.schema.dropTable(OBLIGATIONS);
};
exports.config = { transaction: false };
