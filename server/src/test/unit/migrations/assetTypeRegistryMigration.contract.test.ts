/**
 * T323 (F320) — static Citus contract for the asset_type_registry migration.
 *
 * The behavioral half ran against a Citus 12.1 single-node (distributed 'h',
 * colocated with assets, six built-ins seeded per tenant, idempotent re-run,
 * zero stranded coordinator-heap rows, no RLS) — see
 * ee/docs/plans/2026-06-12-custom-asset-types/SCRATCHPAD.md. This contract
 * pins the source against the greenfield-Citus pattern from
 * docs/architecture/citus-migration-best-practices.md so a later edit cannot
 * silently drop a guard (sibling pattern: teamsObservabilityMigrations).
 */
import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('asset_type_registry migration (Citus greenfield pattern)', () => {
  const migration = readRepoFile('server/migrations/20260612120000_create_asset_type_registry.cjs');

  it('creates the tenant-first table with the composite PK and (tenant, slug) uniqueness', () => {
    expect(migration).toContain("hasTable('asset_type_registry')");
    expect(migration).toContain("table.uuid('tenant').notNullable().references('tenant').inTable('tenants')");
    expect(migration).toContain("table.primary(['tenant', 'type_id'])");
    expect(migration).toContain("table.unique(['tenant', 'slug'], 'asset_type_registry_tenant_slug_uk')");
    expect(migration).toContain("table.jsonb('fields_schema')");
  });

  it('distributes inline behind a Citus guard, colocated with assets', () => {
    expect(migration).toContain("WHERE extname = 'citus'");
    expect(migration).toContain("FROM pg_dist_partition"); // already-distributed re-run guard
    expect(migration).toContain(
      "create_distributed_table('asset_type_registry', 'tenant', colocate_with => 'assets')"
    );
  });

  it('truncates the coordinator-local heap after distributing a possibly-seeded table', () => {
    expect(migration).toContain("truncate_local_data_after_distributing_table('asset_type_registry'::regclass)");
  });

  it('runs outside a transaction (create_distributed_table requirement)', () => {
    expect(migration).toContain('exports.config = { transaction: false }');
  });

  it('does NOT enable RLS (20260509120000 dropped policies schema-wide; isolation is app-layer)', () => {
    expect(migration).not.toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).not.toContain('CREATE POLICY');
    expect(migration).not.toContain("current_setting('app.current_tenant'");
  });

  it('seeds exactly the six built-in slugs idempotently for existing tenants', () => {
    for (const slug of ['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown']) {
      expect(migration).toContain(`slug: '${slug}'`);
    }
    expect(migration).toContain("onConflict(['tenant', 'slug'])");
    expect(migration).toContain('.ignore()');
  });

  it('down() drops the table', () => {
    expect(migration).toContain("dropTableIfExists('asset_type_registry')");
  });
});
