'use strict';

/**
 * Append-only per-case history for RMAs (alga-2026-0002683, card C5). PRD: "rma_events (new)".
 *
 * Same discipline as stock_movements / asset_custody_events: insert-only, a Postgres trigger rejects
 * UPDATE and DELETE, and on Citus (which rejects triggers on distributed tables) the guarantee is app
 * discipline - only recordRmaEvent inserts. Tenant-scoped, distributed on `tenant`. Idempotent.
 */

const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

const EVENT_TYPES = [
  'opened', 'warranty_approved', 'warranty_denied', 'device_received', 'shipped_outbound', 'vendor_case_recorded',
  'replacement_received', 'repair_received', 'vendor_credited', 'returned_to_client', 'closed', 'note',
];
const list = (values) => values.map((v) => `'${v}'`).join(', ');

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('rma_events'))) {
    await knex.schema.createTable('rma_events', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('event_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('rma_id').notNullable();
      table.text('event_type').notNullable();
      table.text('from_status').nullable();
      table.text('to_status').nullable();
      table.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('actor_user_id').nullable();
      table.text('carrier').nullable();
      table.text('tracking_number').nullable();
      table.text('note').nullable();
      table.jsonb('payload').notNullable().defaultTo('{}');
      table.jsonb('document_ids').notNullable().defaultTo('[]');
      table.primary(['tenant', 'event_id']);
    });
    await knex.raw(`
      ALTER TABLE rma_events
        ADD CONSTRAINT rma_events_type_check CHECK (event_type IN (${list(EVENT_TYPES)})),
        ADD CONSTRAINT rma_events_payload_check CHECK (jsonb_typeof(payload) = 'object'),
        ADD CONSTRAINT rma_events_documents_check CHECK (jsonb_typeof(document_ids) = 'array')
    `);
    await knex.raw('CREATE INDEX idx_rma_events_rma ON rma_events (tenant, rma_id, occurred_at)');
    await knex.raw('CREATE INDEX idx_rma_events_type ON rma_events (tenant, event_type, occurred_at)');
  }

  await ensureTenantDistribution(knex, 'rma_events');

  const fk = (constraint, columns, referencedTable, referencedColumns) =>
    ensureCompositeFk(knex, { table: 'rma_events', constraint, columns, referencedTable, referencedColumns });
  await fk('rma_events_rma_fk', ['tenant', 'rma_id'], 'rma_cases', ['tenant', 'rma_id']);
  await fk('rma_events_actor_fk', ['tenant', 'actor_user_id'], 'users', ['tenant', 'user_id']);

  const citus = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  if (!citus.rows?.[0]?.enabled) {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION forbid_rma_event_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'rma_events is an append-only log; % is not allowed', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await knex.raw('DROP TRIGGER IF EXISTS trg_rma_events_immutable ON rma_events');
    await knex.raw(`
      CREATE TRIGGER trg_rma_events_immutable
        BEFORE UPDATE OR DELETE ON rma_events
        FOR EACH ROW EXECUTE FUNCTION forbid_rma_event_mutation()
    `);
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_rma_events_immutable ON rma_events');
  await knex.raw('DROP FUNCTION IF EXISTS forbid_rma_event_mutation()');
  await knex.schema.dropTableIfExists('rma_events');
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
