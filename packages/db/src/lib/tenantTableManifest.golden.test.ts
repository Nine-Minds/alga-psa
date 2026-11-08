import { describe, expect, it } from 'vitest';
import {
  TENANT_TABLE_MANIFEST,
  TenantManifestCycleError,
  computeTenantDeletionOrder,
  placeTenantTable,
  tenantDeletionOrder,
  type TenantTableEntry,
} from './tenantTableManifest';
import type { TenantTableForeignKey } from './tenantTableForeignKeys';

describe('shared tenant table manifest', () => {
  it('preserves the declared deletion order with no restrictive FK violations', () => {
    const order = tenantDeletionOrder();
    const computed = computeTenantDeletionOrder(TENANT_TABLE_MANIFEST);
    expect(computed.violations).toEqual([]);
    expect(computed.order).toEqual(order);
    expect(order).toHaveLength(605);
    expect(new Set(order).size).toBe(order.length);
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
