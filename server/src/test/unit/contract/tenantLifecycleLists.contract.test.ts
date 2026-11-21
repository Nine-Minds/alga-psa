import { describe, expect, it } from 'vitest';
import {
  CLIENT_KEYED_TABLES_HANDLED_EXPLICITLY,
  CLIENT_KEYED_TABLES_LEFT_BEHIND,
  CLIENT_OWNED_MOVE_TABLES,
  PROFILE_HISTORY_TABLES,
} from '../../../../../packages/clients/src/lib/clientMergePlan';
import { TENANT_TABLE_MANIFEST, tenantClientColumns, tenantClientKeyedTables, tenantExportOrder } from '../../../../../packages/db/src/lib/tenantTableManifest';

// Tables the client merge plan classifies that are not tenant-deletion tables keyed on client_id
// in the manifest sense. Each exemption states why.
const MERGE_PLAN_EXEMPTIONS: Record<string, string> = {
  client_plan_bundles: 'classified by the merge plan; not carried as client-keyed in the manifest',
  mcp_oauth_clients: 'its client_id is an OAuth client identifier, not a PSA client key',
};

describe('tenant lifecycle lists', () => {
  const mergePlan = new Set<string>([
    ...CLIENT_OWNED_MOVE_TABLES.map(t => t.table),
    ...CLIENT_KEYED_TABLES_LEFT_BEHIND.map(t => t.table),
    ...CLIENT_KEYED_TABLES_HANDLED_EXPLICITLY,
    ...PROFILE_HISTORY_TABLES.map(t => t.table),
  ]);

  it('clientMergePlan union equals the manifest client_id set plus declared exemptions', () => {
    const manifest = new Set(tenantClientKeyedTables());
    const expected = new Set([...mergePlan].filter(t => !(t in MERGE_PLAN_EXEMPTIONS)));
    expect([...manifest].sort()).toEqual([...expected].sort());
    for (const t of Object.keys(MERGE_PLAN_EXEMPTIONS)) expect(mergePlan.has(t), `${t} exemption is stale`).toBe(true);
  });

  // The roster and the manifest state one fact: the column a table references its client by.
  // A roster entry that names no column means `client_id`.
  it('every merge roster table moves by the client column the manifest declares', () => {
    const declared = new Map(tenantClientColumns().map(entry => [entry.table, entry.column]));
    const roster: Array<{ table: string; clientColumn?: string }> = [
      ...CLIENT_OWNED_MOVE_TABLES,
      ...CLIENT_KEYED_TABLES_LEFT_BEHIND,
      ...CLIENT_KEYED_TABLES_HANDLED_EXPLICITLY.map(entry => (typeof entry === 'string' ? { table: entry } : entry)),
      ...PROFILE_HISTORY_TABLES,
    ];
    for (const entry of roster) {
      if (entry.table in MERGE_PLAN_EXEMPTIONS) continue;
      expect(declared.get(entry.table), entry.table).toBe(entry.clientColumn ?? 'client_id');
    }
  });

  it('every export-list name is a manifest entry', () => {
    const known = new Set(TENANT_TABLE_MANIFEST.map(e => e.table));
    for (const t of tenantExportOrder()) expect(known.has(t), t).toBe(true);
  });
});
