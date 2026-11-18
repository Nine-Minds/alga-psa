/**
 * Co-managed IT L2: retained participation evidence (new table only).
 *
 * No foreign keys, no triggers, no functions: immutability is enforced in app
 * code (Citus skips triggers). Idempotent.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'co_managed_participation_evidence';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
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
      table.uuid('actor_user_id').nullable(); // Null for system actors.
      table.text('actor_kind').nullable();
      table.uuid('actor_contact_id').nullable();
      table.text('actor_name').notNullable();
      table.text('actor_organization').notNullable();
      table.jsonb('payload').notNullable();
      table.text('payload_hash').notNullable();
      table.timestamp('occurred_at', { useTz: true }).notNullable();
      table.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'evidence_id']);
      table.unique(
        ['tenant', 'customer_tenant', 'relationship_id', 'resource_type', 'resource_id', 'source_type', 'source_id'],
        { indexName: 'co_participation_evidence_source_unique' }
      );
      table.check('tenant <> customer_tenant');
      table.check('actor_user_id IS NULL OR actor_tenant IN (tenant, customer_tenant)');
      table.check("resource_type IN ('ticket', 'project_task')");
      table.check("source_type IN ('ticket_handoff', 'work_audit', 'work_snapshot')");
      table.check("jsonb_typeof(payload) = 'object' AND payload_hash ~ '^[0-9a-f]{64}$'");
    });
  }
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove retained participation evidence');
  }
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };
