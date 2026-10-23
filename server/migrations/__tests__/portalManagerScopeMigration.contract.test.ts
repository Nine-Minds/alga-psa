import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20261002090000_add_portal_manager_scope.cjs'));

const makeKnex = (opts: { citus?: boolean; distributed?: Record<string, boolean>; existing?: string[] } = {}) => {
  const raw = vi.fn(async (sql: string, bindings?: unknown[]) => {
    if (sql.includes("extname = 'citus'")) return { rows: [{ has_citus: Boolean(opts.citus) }] };
    if (sql.includes('pg_dist_partition')) {
      return { rows: [{ is_distributed: Boolean(opts.distributed?.[String(bindings?.[0])]) }] };
    }
    if (sql.includes('FROM pg_constraint')) {
      return { rows: [{ present: (opts.existing ?? []).includes(String(bindings?.[0])) }] };
    }
    return { rows: [] };
  });
  return { raw, schema: { hasColumn: vi.fn().mockResolvedValue(false) } };
};
const statements = (knex: ReturnType<typeof makeKnex>) =>
  knex.raw.mock.calls.map(([s]) => String(s).replace(/\s+/g, ' ').trim());

describe('portal manager scope migration', () => {
  it('runs untransacted (CREATE INDEX CONCURRENTLY, Citus DDL ordering)', () => {
    expect(migration.config).toEqual({ transaction: false });
  });

  it('adds composite NO ACTION FKs, never SET NULL, plus the self-manager CHECK', async () => {
    const knex = makeKnex();
    await migration.up(knex);
    const sql = statements(knex).join('\n');

    expect(sql).toContain('FOREIGN KEY (tenant, manager_contact_id) REFERENCES contacts (tenant, contact_name_id)');
    expect(sql).toContain('FOREIGN KEY (tenant, contact_name_id) REFERENCES contacts (tenant, contact_name_id)');
    expect(sql).toContain('CHECK (manager_contact_id IS NULL OR manager_contact_id <> contact_name_id)');
    expect(sql).not.toMatch(/ON DELETE/i);
    expect(sql).toContain("CHECK (asset_scope IN ('client', 'contact'))");
    expect(sql).toContain("CHECK (project_scope IN ('client', 'contact'))");
    expect(sql).toContain("ADD COLUMN asset_scope text NOT NULL DEFAULT 'client'");
    expect(sql).toContain("ADD COLUMN project_scope text NOT NULL DEFAULT 'client'");
  });

  it('is idempotent: existing constraints are not re-added', async () => {
    const knex = makeKnex({
      existing: [
        'contacts_tenant_manager_contact_id_foreign',
        'contacts_manager_not_self_check',
        'assets_tenant_contact_name_id_foreign',
        'client_portal_visibility_groups_asset_scope_check',
        'client_portal_visibility_groups_project_scope_check',
      ],
    });
    knex.schema.hasColumn.mockResolvedValue(true);
    await migration.up(knex);
    expect(statements(knex).filter((s) => s.includes('ADD CONSTRAINT'))).toEqual([]);
    expect(statements(knex).filter((s) => /ADD COLUMN asset_scope|ADD COLUMN project_scope/.test(s))).toEqual([]);
    expect(statements(knex).every((s) => !s.startsWith('ALTER TABLE contacts ADD COLUMN') || s.includes('IF NOT EXISTS'))).toBe(true);
  });

  it('skips the assets FK when assets and contacts have incompatible Citus distribution', async () => {
    const knex = makeKnex({ citus: true, distributed: { contacts: true, assets: false } });
    await migration.up(knex);
    const sql = statements(knex).join('\n');
    expect(sql).not.toContain('assets_tenant_contact_name_id_foreign');
    // contacts -> contacts is always the same table, so the manager FK is still added.
    expect(sql).toContain('contacts_tenant_manager_contact_id_foreign');
  });

  it('adds the assets FK when both tables are distributed', async () => {
    const knex = makeKnex({ citus: true, distributed: { contacts: true, assets: true } });
    await migration.up(knex);
    expect(statements(knex).join('\n')).toContain('assets_tenant_contact_name_id_foreign');
  });
});
