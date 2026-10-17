/**
 * The asset-groups migration died on a real Citus cluster with
 * "referenced table client_locations must be a distributed table or a
 * reference table": `client_locations` is still coordinator-local, and Citus
 * will not distribute a table that references one. These cases pin the shared
 * compatibility probe that replaced the inline foreign key, plus the source
 * contract of the two migrations that use it, so the constraint can never
 * creep back in front of create_distributed_table.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { ensureCompositeFk, isFkCompatible } = require('../../../../migrations/utils/citusDistribution.cjs');

const LOCATION_FK = {
  table: 'asset_groups',
  constraint: 'asset_groups_tenant_location_id_foreign',
  columns: ['tenant', 'location_id'],
  referencedTable: 'client_locations',
  referencedColumns: ['tenant', 'location_id'],
};

function createDatabase(options: { citus: boolean; distributed?: string[]; constraints?: string[] }) {
  const distributed = new Set(options.distributed ?? []);
  const constraints = new Set(options.constraints ?? []);
  const statements: string[] = [];

  const knex = {
    raw: vi.fn(async (sql: string, bindings: unknown[] = []) => {
      statements.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('extname =')) return { rows: [{ has_citus: options.citus }] };
      if (sql.includes('pg_dist_partition')) {
        return { rows: [{ is_distributed: distributed.has(String(bindings[0])) }] };
      }
      if (sql.includes('pg_constraint')) {
        return { rows: [{ present: constraints.has(String(bindings[0])) }] };
      }
      if (sql.includes('DROP CONSTRAINT')) constraints.delete(LOCATION_FK.constraint);
      if (sql.includes('ADD CONSTRAINT')) constraints.add(LOCATION_FK.constraint);
      return { rows: [] };
    }),
  };

  return { knex, constraints, statements };
}

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Citus composite-FK compatibility probe', () => {
  it('rejects a foreign key from a distributed table to a coordinator-local one', async () => {
    const { knex } = createDatabase({ citus: true, distributed: ['asset_groups'] });
    await expect(isFkCompatible(knex, 'asset_groups', 'client_locations')).resolves.toBe(false);
  });

  it('allows it when both sides are distributed, and when Citus is absent', async () => {
    const citus = createDatabase({ citus: true, distributed: ['asset_groups', 'client_locations'] });
    await expect(isFkCompatible(citus.knex, 'asset_groups', 'client_locations')).resolves.toBe(true);

    const plain = createDatabase({ citus: false });
    await expect(isFkCompatible(plain.knex, 'asset_groups', 'client_locations')).resolves.toBe(true);
  });

  it('adds the constraint on plain Postgres', async () => {
    const { knex, constraints, statements } = createDatabase({ citus: false });
    await expect(ensureCompositeFk(knex, LOCATION_FK)).resolves.toBe(true);
    expect(constraints.has(LOCATION_FK.constraint)).toBe(true);
    expect(statements.some((sql) => sql.includes(
      'ADD CONSTRAINT asset_groups_tenant_location_id_foreign FOREIGN KEY (tenant, location_id) ' +
      'REFERENCES client_locations (tenant, location_id)'
    ))).toBe(true);
  });

  it('skips the constraint on Citus where the referenced table is local', async () => {
    const { knex, constraints, statements } = createDatabase({ citus: true, distributed: ['asset_groups'] });
    await expect(ensureCompositeFk(knex, LOCATION_FK)).resolves.toBe(false);
    expect(constraints.size).toBe(0);
    expect(statements.some((sql) => sql.includes('ADD CONSTRAINT'))).toBe(false);
  });

  it('drops a leftover constraint from a half-applied run so distribution can proceed', async () => {
    const { knex, constraints, statements } = createDatabase({
      citus: true,
      distributed: ['asset_groups'],
      constraints: [LOCATION_FK.constraint],
    });
    await ensureCompositeFk(knex, LOCATION_FK);
    expect(constraints.has(LOCATION_FK.constraint)).toBe(false);
    expect(statements.some((sql) => sql.includes(
      'ALTER TABLE asset_groups DROP CONSTRAINT asset_groups_tenant_location_id_foreign'
    ))).toBe(true);
  });

  it('is a no-op when the constraint is already in place', async () => {
    const { knex, statements } = createDatabase({
      citus: true,
      distributed: ['asset_groups', 'client_locations'],
      constraints: [LOCATION_FK.constraint],
    });
    await expect(ensureCompositeFk(knex, LOCATION_FK)).resolves.toBe(true);
    expect(statements.some((sql) => sql.includes('ADD CONSTRAINT') || sql.includes('DROP CONSTRAINT'))).toBe(false);
  });
});

describe('asset group and billing profile migrations (Citus foreign keys)', () => {
  const groups = readRepoFile('server/migrations/20261009124000_create_asset_groups.cjs');
  const profiles = readRepoFile('server/migrations/20261009125000_add_asset_billing_profile.cjs');

  it('creates asset_groups without an inline client_locations foreign key', () => {
    expect(groups).not.toContain("inTable('client_locations')");
    expect(groups).toContain("table.foreign(['tenant', 'client_id'])");
  });

  it('clears a leftover location foreign key before distributing', () => {
    const drop = groups.indexOf('DROP CONSTRAINT IF EXISTS');
    const distribute = groups.indexOf("ensureTenantDistribution(knex, 'asset_groups')");
    expect(drop).toBeGreaterThan(-1);
    expect(distribute).toBeGreaterThan(drop);
  });

  it('adds the location foreign key through the probe after distribution', () => {
    const distribute = groups.indexOf("ensureTenantDistribution(knex, 'asset_group_contacts')");
    const fk = groups.indexOf('ensureCompositeFk(knex, LOCATION_FK)');
    expect(fk).toBeGreaterThan(distribute);
  });

  it('routes both billing-profile foreign keys through the probe', () => {
    expect(profiles).not.toContain("inTable('client_billing_profiles')");
    expect(profiles).toContain("table: 'assets'");
    expect(profiles).toContain("table: 'rmm_organization_mappings'");
    expect(profiles).toContain('ensureCompositeFk(knex, fk)');
  });
});
