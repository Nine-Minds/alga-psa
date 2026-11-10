import { describe, expect, it } from 'vitest';
import {
  CLIENT_KEYED_TABLES_HANDLED_EXPLICITLY,
  CLIENT_KEYED_TABLES_LEFT_BEHIND,
  CLIENT_MERGE_ROSTER,
  CLIENT_OWNED_MOVE_TABLES,
  CLIENT_REFERENCE_COLUMNS_WITHOUT_FK,
  PROFILE_HISTORY_TABLES,
  classifiedClientColumns,
  clientColumnOf,
  findUnclassifiedClientReferences,
} from '../../../../../packages/clients/src/lib/clientMergePlan';
import { TENANT_TABLE_FOREIGN_KEYS } from '../../../../../packages/db/src/lib/tenantTableForeignKeys';
import { TENANT_TABLE_MANIFEST, tenantClientKeyedTables, tenantExportOrder } from '../../../../../packages/db/src/lib/tenantTableManifest';

// Tables the client merge plan classifies that are not tenant-deletion tables keyed on client_id
// in the manifest sense. Each exemption states why.
const MERGE_PLAN_EXEMPTIONS: Record<string, string> = {
  client_plan_bundles: 'classified by the merge plan; not carried as client-keyed in the manifest',
  mcp_oauth_clients: 'its client_id is an OAuth client identifier, not a PSA client key',
};

describe('tenant lifecycle lists', () => {
  // The manifest's clientKeyed flag is about `client_id` columns, so only the entries that
  // use that column are compared with it; entries naming another column are covered by the
  // foreign-key completeness check below.
  const mergePlan = new Set<string>(
    [
      ...CLIENT_OWNED_MOVE_TABLES,
      ...CLIENT_KEYED_TABLES_LEFT_BEHIND,
      ...CLIENT_KEYED_TABLES_HANDLED_EXPLICITLY,
      ...PROFILE_HISTORY_TABLES,
    ].filter(t => clientColumnOf(t as { clientColumn?: string }) === 'client_id').map(t => t.table),
  );

  it('clientMergePlan union equals the manifest clientKeyed set plus declared exemptions', () => {
    const manifest = new Set(tenantClientKeyedTables());
    const expected = new Set([...mergePlan].filter(t => !(t in MERGE_PLAN_EXEMPTIONS)));
    expect([...manifest].sort()).toEqual([...expected].sort());
    for (const t of Object.keys(MERGE_PLAN_EXEMPTIONS)) expect(mergePlan.has(t), `${t} exemption is stale`).toBe(true);
  });

  it('every export-list name is a manifest entry', () => {
    const known = new Set(TENANT_TABLE_MANIFEST.map(e => e.table));
    for (const t of tenantExportOrder()) expect(known.has(t), t).toBe(true);
  });

  it('classifies every foreign key to clients, under any column name', () => {
    expect(findUnclassifiedClientReferences(TENANT_TABLE_FOREIGN_KEYS, CLIENT_MERGE_ROSTER, CLIENT_REFERENCE_COLUMNS_WITHOUT_FK)).toEqual([]);
  });

  it('names the columns that are not client_id in the roster', () => {
    const classified = classifiedClientColumns(CLIENT_MERGE_ROSTER);
    expect(classified.has('purchase_orders.drop_ship_client_id')).toBe(true);
    expect(classified.has('contracts.owner_client_id')).toBe(true);
    // The snapshot lists contracts.owner_client_id twice; duplicates must not matter.
    const dupes = TENANT_TABLE_FOREIGN_KEYS.filter(f => f.parent === 'clients' && f.child === 'contracts' && f.column === 'owner_client_id');
    expect(dupes.length).toBeGreaterThanOrEqual(1);
  });

  it('T003: reports a foreign key to clients on an unclassified column name', () => {
    const fixture = [
      ...TENANT_TABLE_FOREIGN_KEYS,
      { child: 'widget_orders', parent: 'clients', column: 'billed_client_id', deleteRule: 'NO ACTION', name: 'fake_fk' },
      { child: 'widget_orders', parent: 'clients', column: 'billed_client_id', deleteRule: 'NO ACTION', name: 'fake_fk_dupe' },
    ];
    expect(findUnclassifiedClientReferences(fixture, CLIENT_MERGE_ROSTER, CLIENT_REFERENCE_COLUMNS_WITHOUT_FK))
      .toEqual(['widget_orders.billed_client_id']);
  });

  it('reports a roster missing its purchase_orders entry', () => {
    const roster = { ...CLIENT_MERGE_ROSTER, moved: CLIENT_OWNED_MOVE_TABLES.filter(t => t.table !== 'purchase_orders') };
    expect(findUnclassifiedClientReferences(TENANT_TABLE_FOREIGN_KEYS, roster, CLIENT_REFERENCE_COLUMNS_WITHOUT_FK))
      .toEqual(['purchase_orders.drop_ship_client_id']);
  });

  it('classifies each no-FK client column and gives every left-behind table a reason', () => {
    const classified = classifiedClientColumns(CLIENT_MERGE_ROSTER);
    for (const c of CLIENT_REFERENCE_COLUMNS_WITHOUT_FK) expect(classified.has(`${c.table}.${c.column}`), `${c.table}.${c.column}`).toBe(true);
    for (const t of CLIENT_KEYED_TABLES_LEFT_BEHIND) expect(t.reason.length, t.table).toBeGreaterThan(0);
  });
});
