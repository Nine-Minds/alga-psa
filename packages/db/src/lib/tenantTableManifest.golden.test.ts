import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  TENANT_TABLE_MANIFEST,
  TenantManifestCycleError,
  computeTenantDeletionOrder,
  placeTenantTable,
  tenantDeletionOrder,
  type TenantTableEntry,
} from './tenantTableManifest';
import type { TenantTableForeignKey } from './tenantTableForeignKeys';

const ACTIVITY = path.resolve(__dirname, '../../../../ee/temporal-workflows/src/activities/tenant-deletion-activities.ts');

function parseActivityLiteral(): string[] {
  const content = readFileSync(ACTIVITY, 'utf-8');
  const match = content.match(/const\s+TENANT_TABLES_DELETION_ORDER\s*:\s*string\[\]\s*=\s*\[([\s\S]*?)\n\];/);
  if (!match) throw new Error('TENANT_TABLES_DELETION_ORDER not found');
  return [...match[1].replace(/\/\/.*$/gm, '').matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]);
}

describe('tenant table manifest golden order', () => {
  it('computed order equals the activity literal element for element, with zero violations', () => {
    const literal = parseActivityLiteral();
    const computed = computeTenantDeletionOrder();
    expect(computed.violations).toEqual([]);
    expect(computed.order).toEqual(literal);
    expect(tenantDeletionOrder()).toEqual(literal);
  });

  it('has 578 unique ordered names', () => {
    const order = tenantDeletionOrder();
    expect(order).toHaveLength(578);
    expect(new Set(order).size).toBe(578);
  });

  it('declares the eight breakCircularDependencies FKs as null-before-delete', () => {
    const declared = TENANT_TABLE_MANIFEST.flatMap(e => (e.references ?? []).map(r => `${e.table}.${r.column}->${r.table}`)).sort();
    expect(declared).toEqual([
      'assets.stock_unit_id->stock_units',
      'authorization_bundles.published_revision_id->authorization_bundle_revisions',
      'clients.account_manager_id->users',
      'contacts.client_id->clients',
      'inbound_ticket_defaults.client_id->clients',
      'opportunities.suggestion_id->opportunity_suggestions',
      'statuses.board_id->boards',
      'stock_units.allocated_staging_line_id->project_staging_lines',
    ]);
  });

  it('keeps the eight declarations in step with the breakCircularDependencies source', () => {
    const src = readFileSync(ACTIVITY, 'utf-8');
    const start = src.indexOf('breakCircularDependencies');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start);
    for (const [table, column] of [
      ['assets', 'stock_unit_id'], ['authorization_bundles', 'published_revision_id'], ['clients', 'account_manager_id'],
      ['contacts', 'client_id'], ['inbound_ticket_defaults', 'client_id'], ['opportunities', 'suggestion_id'],
      ['statuses', 'board_id'], ['stock_units', 'allocated_staging_line_id'],
    ]) {
      expect(body, `${table}.${column}`).toMatch(new RegExp(`${table}[\\s\\S]{0,400}${column}`));
    }
  });
});

describe('ordering engine', () => {
  const fk = (child: string, parent: string, column = 'x_id'): TenantTableForeignKey =>
    ({ child, parent, column, deleteRule: 'NO ACTION', name: `${child}_${parent}` });
  const ordered = (...tables: string[]): TenantTableEntry[] => tables.map(table => ({ table, deletion: 'ordered' }));

  it('returns a valid declared order unchanged', () => {
    const r = computeTenantDeletionOrder(ordered('c', 'b', 'a'), [fk('c', 'b'), fk('b', 'a')]);
    expect(r.order).toEqual(['c', 'b', 'a']);
    expect(r.violations).toEqual([]);
  });

  it('reports violations and computes a legal order', () => {
    const r = computeTenantDeletionOrder(ordered('a', 'b'), [fk('b', 'a')]);
    expect(r.order).toEqual(['b', 'a']);
    expect(r.violations).toHaveLength(1);
    expect(r.insertions.map(i => i.table).sort()).toEqual(['a', 'b']);
  });

  it('raises TenantManifestCycleError for an undeclared cycle', () => {
    expect(() => computeTenantDeletionOrder(ordered('a', 'b'), [fk('a', 'b'), fk('b', 'a')])).toThrow(TenantManifestCycleError);
  });

  it('accepts a cycle broken by a null-before-delete declaration', () => {
    const manifest: TenantTableEntry[] = [
      { table: 'a', deletion: 'ordered', references: [{ table: 'b', column: 'b_id', onDelete: 'NO ACTION', resolution: 'null-before-delete' }] },
      { table: 'b', deletion: 'ordered' },
    ];
    const r = computeTenantDeletionOrder(manifest, [fk('a', 'b', 'b_id'), fk('b', 'a', 'a_id')]);
    expect(r.order).toEqual(['b', 'a']);
  });

  it('placeTenantTable gives the legal window for a new table', () => {
    const w = placeTenantTable('n', ['c', 'b', 'a'], [fk('c', 'n'), fk('n', 'a')], ordered('c', 'b', 'a'));
    expect(w.mustFollow).toEqual(['c']);
    expect(w.mustPrecede).toEqual(['a']);
    expect(w.insertAfter).toBe('c');
    expect(w.earliestIndex).toBeLessThanOrEqual(w.latestIndex);
  });

  it('does not run on the runtime path: tenantDeletionOrder never throws on a cyclic custom manifest', () => {
    expect(tenantDeletionOrder(ordered('a', 'b'))).toEqual(['a', 'b']);
  });
});
