/**
 * Equipment custody for client-owned devices (alga-2026-0002683, card C4).
 * Design of record: ee/docs/plans/2026-10-20-physical-work-tags/design-C4-equipment-custody.md
 *
 * - assets.ownership ('client' | 'msp'); every existing asset is a client's, so the default backfills.
 * - `held_by_msp` asset status (kind pending) for every EXISTING tenant. New tenants:
 *   ee/server/seeds/onboarding/psa/11_asset_statuses.cjs.
 * - asset_custody: one row per stay at the MSP (episode), mutable while open.
 *   At most one open episode per asset (partial unique index; includes the distribution column).
 * - asset_custody_events: append-only chain of custody. A Postgres trigger rejects UPDATE/DELETE;
 *   Citus rejects triggers on distributed tables, so there it is app discipline (only
 *   recordCustodyEvent inserts) - the same trade-off as stock_movements.
 *
 * Custody never touches stock: no stock_* reference exists on these tables beyond the location FK.
 * Idempotent; safe to re-run.
 */

const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

const STATES = ['in_office', 'with_vendor', 'closed'];
const PURPOSES = ['repair', 'warranty_evaluation', 'loaner_prep', 'staging'];
const PARTIES = ['msp', 'client', 'vendor'];
const CLOSE_REASONS = ['returned_to_client', 'disposed', 'transferred_to_rma'];
const EVENT_TYPES = ['received', 'moved', 'handed_off', 'shipped', 'returned'];

const list = (values) => values.map((v) => `'${v}'`).join(', ');

exports.up = async function up(knex) {
  // --- ownership ---
  if (!(await knex.schema.hasColumn('assets', 'ownership'))) {
    await knex.schema.alterTable('assets', (table) => {
      table.text('ownership').notNullable().defaultTo('client');
    });
  }
  await knex.raw('ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_ownership_check');
  // migration-lint: allow 2 - retroactive: ownership CHECK re-created after DROP IF EXISTS on assets in the same migration that introduces the column values; merged before the lint existed
  await knex.raw(`ALTER TABLE assets ADD CONSTRAINT assets_ownership_check CHECK (ownership IN ('client', 'msp'))`);

  // --- held_by_msp status for existing tenants ---
  if (await knex.schema.hasTable('asset_statuses')) {
    const tenants = await knex('tenants').select('tenant');
    for (const { tenant } of tenants) {
      // migration-lint: allow 5 - retroactive: one held_by_msp status row per tenant (bounded by tenant count), idempotent insert; merged before the lint existed
      await knex('asset_statuses')
        .insert({
          tenant,
          slug: 'held_by_msp',
          label: 'Held by MSP',
          kind: 'pending',
          is_builtin: true,
          is_active: true,
          display_order: 5,
        })
        .onConflict(['tenant', 'slug'])
        .ignore();
    }
  }

  // --- asset_custody ---
  if (!(await knex.schema.hasTable('asset_custody'))) {
    await knex.schema.createTable('asset_custody', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('custody_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('asset_id').notNullable();
      table.uuid('client_id').notNullable();
      table.uuid('ticket_id').nullable();
      table.text('state').notNullable().defaultTo('in_office');
      table.text('purpose').notNullable();
      table.uuid('holder_user_id').nullable();
      table.uuid('location_id').nullable();
      table.text('bin').nullable();
      table.text('next_action_party').notNullable().defaultTo('msp');
      table.text('next_action_note').nullable();
      table.date('follow_up_on').nullable();
      table.text('condition_note').nullable();
      table.jsonb('accessories').notNullable().defaultTo('[]');
      table.timestamp('opened_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('opened_by').nullable();
      table.timestamp('closed_at', { useTz: true }).nullable();
      table.uuid('closed_by').nullable();
      table.text('close_reason').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'custody_id']);
    });

    await knex.raw(`
      ALTER TABLE asset_custody
        ADD CONSTRAINT asset_custody_state_check CHECK (state IN (${list(STATES)})),
        ADD CONSTRAINT asset_custody_purpose_check CHECK (purpose IN (${list(PURPOSES)})),
        ADD CONSTRAINT asset_custody_party_check CHECK (next_action_party IN (${list(PARTIES)})),
        ADD CONSTRAINT asset_custody_close_reason_check
          CHECK (close_reason IS NULL OR close_reason IN (${list(CLOSE_REASONS)})),
        ADD CONSTRAINT asset_custody_in_office_check
          CHECK (state <> 'in_office' OR (holder_user_id IS NOT NULL AND location_id IS NOT NULL)),
        ADD CONSTRAINT asset_custody_closed_check
          CHECK ((state = 'closed') = (closed_at IS NOT NULL)),
        ADD CONSTRAINT asset_custody_accessories_check CHECK (jsonb_typeof(accessories) = 'array')
    `);
    await knex.raw(`
      CREATE UNIQUE INDEX asset_custody_one_open_per_asset
        ON asset_custody (tenant, asset_id) WHERE closed_at IS NULL
    `);
    await knex.raw(`CREATE INDEX idx_asset_custody_state_follow_up ON asset_custody (tenant, state, follow_up_on)`);
    await knex.raw(`CREATE INDEX idx_asset_custody_open_location ON asset_custody (tenant, location_id) WHERE closed_at IS NULL`);
    await knex.raw(`CREATE INDEX idx_asset_custody_ticket ON asset_custody (tenant, ticket_id)`);
    await knex.raw(`CREATE INDEX idx_asset_custody_open_holder ON asset_custody (tenant, holder_user_id) WHERE closed_at IS NULL`);
    await knex.raw(`CREATE INDEX idx_asset_custody_asset ON asset_custody (tenant, asset_id, opened_at)`);
  }

  // --- asset_custody_events ---
  if (!(await knex.schema.hasTable('asset_custody_events'))) {
    await knex.schema.createTable('asset_custody_events', (table) => {
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('event_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('custody_id').notNullable();
      table.uuid('asset_id').notNullable();
      table.text('event_type').notNullable();
      table.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('actor_user_id').nullable();
      table.uuid('from_location_id').nullable();
      table.text('from_bin').nullable();
      table.uuid('to_location_id').nullable();
      table.text('to_bin').nullable();
      table.uuid('from_holder_user_id').nullable();
      table.uuid('to_holder_user_id').nullable();
      table.text('counterparty').nullable();
      table.text('note').nullable();
      table.jsonb('document_ids').notNullable().defaultTo('[]');
      table.primary(['tenant', 'event_id']);
    });
    await knex.raw(`
      ALTER TABLE asset_custody_events
        ADD CONSTRAINT asset_custody_events_type_check CHECK (event_type IN (${list(EVENT_TYPES)})),
        ADD CONSTRAINT asset_custody_events_documents_check CHECK (jsonb_typeof(document_ids) = 'array')
    `);
    await knex.raw(`CREATE INDEX idx_asset_custody_events_custody ON asset_custody_events (tenant, custody_id, occurred_at)`);
    await knex.raw(`CREATE INDEX idx_asset_custody_events_asset ON asset_custody_events (tenant, asset_id, occurred_at)`);
  }

  await ensureTenantDistribution(knex, 'asset_custody');
  await ensureTenantDistribution(knex, 'asset_custody_events');

  // Composite FKs (added after distribution; skipped where Citus cannot enforce them).
  const fk = (table, constraint, columns, referencedTable, referencedColumns) =>
    ensureCompositeFk(knex, { table, constraint, columns, referencedTable, referencedColumns });
  await fk('asset_custody', 'asset_custody_asset_fk', ['tenant', 'asset_id'], 'assets', ['tenant', 'asset_id']);
  await fk('asset_custody', 'asset_custody_ticket_fk', ['tenant', 'ticket_id'], 'tickets', ['tenant', 'ticket_id']);
  await fk('asset_custody', 'asset_custody_holder_fk', ['tenant', 'holder_user_id'], 'users', ['tenant', 'user_id']);
  await fk('asset_custody', 'asset_custody_location_fk', ['tenant', 'location_id'], 'stock_locations', ['tenant', 'location_id']);
  await fk('asset_custody_events', 'asset_custody_events_custody_fk', ['tenant', 'custody_id'], 'asset_custody', ['tenant', 'custody_id']);

  // Append-only on plain Postgres. Citus rejects triggers on distributed tables.
  const citus = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  if (!citus.rows?.[0]?.enabled) {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION forbid_asset_custody_event_mutation() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'asset_custody_events is an append-only log; % is not allowed', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await knex.raw('DROP TRIGGER IF EXISTS trg_asset_custody_events_immutable ON asset_custody_events');
    await knex.raw(`
      CREATE TRIGGER trg_asset_custody_events_immutable
        BEFORE UPDATE OR DELETE ON asset_custody_events
        FOR EACH ROW EXECUTE FUNCTION forbid_asset_custody_event_mutation()
    `);
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS trg_asset_custody_events_immutable ON asset_custody_events');
  await knex.raw('DROP FUNCTION IF EXISTS forbid_asset_custody_event_mutation()');
  await knex.schema.dropTableIfExists('asset_custody_events');
  await knex.schema.dropTableIfExists('asset_custody');
  if (await knex.schema.hasTable('asset_statuses')) {
    await knex('asset_statuses').where({ slug: 'held_by_msp', is_builtin: true }).del();
  }
  await knex.raw('ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_ownership_check');
  if (await knex.schema.hasColumn('assets', 'ownership')) {
    await knex.schema.alterTable('assets', (table) => table.dropColumn('ownership'));
  }
};

// create_distributed_table cannot run inside a transaction block.
exports.config = { transaction: false };
