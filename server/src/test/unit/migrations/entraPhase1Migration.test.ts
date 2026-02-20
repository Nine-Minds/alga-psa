import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Entra Phase 1 migration', () => {
  const migration = readRepoFile('ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs');

  it('T011: creates entra_partner_connections with expected required columns', () => {
    expect(migration).toContain("createTable('entra_partner_connections'");
    expect(migration).toContain("table.uuid('tenant').notNullable()");
    expect(migration).toContain("table.text('connection_type').notNullable()");
    expect(migration).toContain("table.text('status').notNullable().defaultTo('disconnected')");
    expect(migration).toContain("table.boolean('is_active').notNullable().defaultTo(false)");
    expect(migration).toContain("table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())");
    expect(migration).toContain("table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())");
  });

  it('T012: enforces unique active Entra connection per tenant', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_entra_partner_connections_active_per_tenant');
    expect(migration).toContain('ON entra_partner_connections (tenant)');
    expect(migration).toContain('WHERE is_active = true');
  });

  it('T013: creates entra_managed_tenants and lookup indexes for discovery/mapping', () => {
    expect(migration).toContain("createTable('entra_managed_tenants'");
    expect(migration).toContain("table.text('entra_tenant_id').notNullable()");
    expect(migration).toContain("table.text('primary_domain')");
    expect(migration).toContain("table.integer('source_user_count').notNullable().defaultTo(0)");
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_entra_managed_tenants_tenant_last_seen');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_entra_managed_tenants_tenant_primary_domain');
  });

  it('T014: creates tenant mappings table with unique active mapping per discovered tenant', () => {
    expect(migration).toContain("createTable('entra_client_tenant_mappings'");
    expect(migration).toContain("table.text('mapping_state').notNullable().defaultTo('needs_review')");
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_entra_client_tenant_mappings_active');
    expect(migration).toContain('ON entra_client_tenant_mappings (tenant, managed_tenant_id)');
    expect(migration).toContain('WHERE is_active = true');
  });

  it('T015: creates entra_sync_settings with default cadence and sync toggle fields', () => {
    expect(migration).toContain("createTable('entra_sync_settings'");
    expect(migration).toContain("table.boolean('sync_enabled').notNullable().defaultTo(true)");
    expect(migration).toContain("table.integer('sync_interval_minutes').notNullable().defaultTo(1440)");
    expect(migration).toContain("table.jsonb('field_sync_config').notNullable().defaultTo(knex.raw(`'{}'::jsonb`))");
    expect(migration).toContain("table.jsonb('user_filter_config').notNullable().defaultTo(knex.raw(`'{}'::jsonb`))");
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_entra_sync_settings_tenant');
  });

  it('T016: creates entra_sync_runs with run status and counter fields', () => {
    expect(migration).toContain("createTable('entra_sync_runs'");
    expect(migration).toContain("table.text('status').notNullable().defaultTo('queued')");
    expect(migration).toContain("table.integer('total_tenants').notNullable().defaultTo(0)");
    expect(migration).toContain("table.integer('processed_tenants').notNullable().defaultTo(0)");
    expect(migration).toContain("table.integer('succeeded_tenants').notNullable().defaultTo(0)");
    expect(migration).toContain("table.integer('failed_tenants').notNullable().defaultTo(0)");
    expect(migration).toContain("table.jsonb('summary').notNullable().defaultTo(knex.raw(`'{}'::jsonb`))");
  });

  it('T017: creates entra_sync_run_tenants with tenant-scoped FK to parent sync runs', () => {
    expect(migration).toContain("createTable('entra_sync_run_tenants'");
    expect(migration).toContain("table.uuid('run_id').notNullable()");
    expect(migration).toContain("table.integer('created_count').notNullable().defaultTo(0)");
    expect(migration).toContain(".foreign(['tenant', 'run_id'])");
    expect(migration).toContain(".references(['tenant', 'run_id'])");
    expect(migration).toContain(".inTable('entra_sync_runs')");
  });

  it('T018: creates entra_contact_links with unique Entra identity constraint', () => {
    expect(migration).toContain("createTable('entra_contact_links'");
    expect(migration).toContain("table.text('entra_tenant_id').notNullable()");
    expect(migration).toContain("table.text('entra_object_id').notNullable()");
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_entra_contact_links_entra_identity');
    expect(migration).toContain('ON entra_contact_links (tenant, entra_tenant_id, entra_object_id)');
  });

  it('T019: enforces one active Entra link per contact', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS ux_entra_contact_links_active_contact');
    expect(migration).toContain('ON entra_contact_links (tenant, contact_name_id)');
    expect(migration).toContain('WHERE is_active = true');
  });

  it('T020: creates reconciliation queue table with status and identity lookup indexes', () => {
    expect(migration).toContain("createTable('entra_contact_reconciliation_queue'");
    expect(migration).toContain("table.text('status').notNullable().defaultTo('open')");
    expect(migration).toContain("table.jsonb('candidate_contacts').notNullable().defaultTo(knex.raw(`'[]'::jsonb`))");
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_entra_reconciliation_queue_status');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_entra_reconciliation_queue_identity');
  });

  it('T021: adds Entra linkage columns to clients table and lookup index', () => {
    expect(migration).toContain("ensureColumn(knex, 'clients', 'entra_tenant_id'");
    expect(migration).toContain("table.text('entra_tenant_id')");
    expect(migration).toContain("ensureColumn(knex, 'clients', 'entra_primary_domain'");
    expect(migration).toContain("table.text('entra_primary_domain')");
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_clients_entra_tenant');
    expect(migration).toContain('ON clients (tenant, entra_tenant_id)');
  });

  it('T022: adds Entra identity and sync metadata columns to contacts table', () => {
    expect(migration).toContain("ensureColumn(knex, 'contacts', 'entra_object_id'");
    expect(migration).toContain("ensureColumn(knex, 'contacts', 'entra_sync_source'");
    expect(migration).toContain("ensureColumn(knex, 'contacts', 'last_entra_sync_at'");
    expect(migration).toContain("ensureColumn(knex, 'contacts', 'entra_user_principal_name'");
    expect(migration).toContain("ensureColumn(knex, 'contacts', 'entra_account_enabled'");
    expect(migration).toContain("ensureColumn(knex, 'contacts', 'entra_sync_status'");
    expect(migration).toContain("ensureColumn(knex, 'contacts', 'entra_sync_status_reason'");
    expect(migration).toContain("table.text('entra_object_id')");
    expect(migration).toContain("table.timestamp('last_entra_sync_at', { useTz: true })");
    expect(migration).toContain("table.boolean('entra_account_enabled')");
  });

  it('T023: backfills one default entra_sync_settings row per existing tenant', () => {
    expect(migration).toContain('INSERT INTO entra_sync_settings');
    expect(migration).toContain('SELECT');
    expect(migration).toContain('FROM tenants');
    expect(migration).toContain('WHERE NOT EXISTS');
    expect(migration).toContain('FROM entra_sync_settings');
    expect(migration).toContain('entra_sync_settings.tenant = tenants.tenant');
    expect(migration).toContain('1440');
  });
});
