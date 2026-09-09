const { ensureTenantDistribution, supportsTriggers } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_managed_participation_evidence';
exports.up = async function(knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable();
    table.uuid('evidence_id').notNullable();
    table.uuid('customer_tenant').notNullable();
    table.uuid('relationship_id').notNullable();
    table.uuid('resource_id').notNullable();
    table.text('resource_type').notNullable();
    table.uuid('client_id').notNullable();
    table.text('source_type').notNullable();
    table.uuid('source_id').notNullable();
    table.uuid('operation_id').notNullable();
    table.text('event_type').notNullable();
    table.uuid('actor_tenant').notNullable();
    table.uuid('actor_user_id').notNullable();
    table.text('actor_name').notNullable();
    table.text('actor_organization').notNullable();
    table.jsonb('payload').notNullable();
    table.text('payload_hash').notNullable();
    table.timestamp('occurred_at', { useTz: true }).notNullable();
    table.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'evidence_id']);
    table.unique(['tenant', 'customer_tenant', 'relationship_id', 'resource_type', 'resource_id', 'source_type', 'source_id'], { indexName: 'co_participation_evidence_source_unique' });
    table.check('tenant <> customer_tenant AND actor_tenant IN (tenant, customer_tenant)');
    table.check("resource_type IN ('ticket', 'project_task')");
    table.check("source_type IN ('ticket_handoff', 'work_audit')");
    table.check("jsonb_typeof(payload) = 'object' AND payload_hash ~ '^[0-9a-f]{64}$'");
  });
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex('pg_constraint').where('conname', 'co_participation_evidence_owner_fk').whereRaw('conrelid = ?::regclass', [TABLE]).first())
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant'], 'co_participation_evidence_owner_fk').references(['tenant']).inTable('tenants'));
  // No customer, source, actor or client FK: this is already-retained evidence.
  await knex.raw(`CREATE OR REPLACE FUNCTION co_managed_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Retained co-management evidence is immutable' USING ERRCODE = '23514'; END; $$`);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw(`DROP TRIGGER IF EXISTS co_managed_evidence_immutable ON ${TABLE}`);
    await knex.raw(`CREATE TRIGGER co_managed_evidence_immutable BEFORE UPDATE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION co_managed_evidence_immutable()`);
  }
};
exports.down = async function(knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove retained participation evidence');
  await knex.schema.dropTableIfExists(TABLE);
  await knex.raw('DROP FUNCTION IF EXISTS co_managed_evidence_immutable()');
};
exports.config = { transaction: false };
