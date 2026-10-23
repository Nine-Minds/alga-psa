import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './client-assets.ts'),
  'utf8',
);

describe('client-assets server action contract', () => {
  it('exports a paginated/searchable listClientAssets action', () => {
    expect(source).toContain('export const listClientAssets = withAuth');
    expect(source).toContain('ListClientAssetsResponse');
    expect(source).toContain('total: Number(filteredCount?.count ?? 0)');
  });

  it('returns server-computed per-type counts for the summary tiles', () => {
    expect(source).toContain('by_type: byType');
    expect(source).toContain(".groupBy('asset_type')");
  });

  it('FR-B5: reports the statuses in use, with their registry kind, instead of an active/inactive pair', () => {
    // "status <> 'inactive' => active" is how the banner announced all devices
    // active with one in repair, and how the filter could only offer two
    // statuses. The statuses in use travel with the response now.
    expect(source).toContain("} from '@alga-psa/assets/lib/assetStatusRegistry';");
    expect(source).toContain('assetStatusKindForSlug');
    expect(source).toContain('assetStatusLabelForSlug');
    expect(source).toContain('by_status: buildStatusSummary(statusRows, statusCounts)');
    expect(source).toContain(".groupBy('status')");
    expect(source).toContain('listAssetStatusRows(trx, tenant, { includeArchived: true })');
    expect(source).not.toMatch(/whereNot\('status', 'inactive'\)/);
    expect(source).not.toMatch(/status <> 'inactive'/);
  });

  it('filters by the status slug the caller asked for', () => {
    expect(source).toContain("if (params.status) q.where('status', params.status);");
  });

  it('keeps a backwards-compatible getClientAssets export for previews', () => {
    expect(source).toContain('export const getClientAssets = withAuth');
  });

  it('applies pagination via limit/offset', () => {
    expect(source).toContain('.limit(limit)');
    expect(source).toContain('.offset(offset);');
  });

  it('filters by search across name, asset_tag, and serial_number', () => {
    expect(source).toMatch(/LOWER\(name\) LIKE/);
    expect(source).toMatch(/LOWER\(asset_tag\) LIKE/);
    expect(source).toMatch(/LOWER\(serial_number\) LIKE/);
  });

  it('caps limit to a sensible maximum', () => {
    expect(source).toMatch(/MAX_LIMIT/);
  });

  it('still scopes queries by tenant + the resolved client_id', () => {
    expect(source).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db'");
    expect(source).toContain("tenantScopedTable(trx, 'assets', tenant)");
    expect(source).toContain("clientColumn: 'assets.client_id'");
    expect(source).not.toContain('{ tenant, client_id: clientId }');
  });

  it('routes every asset read through the visibility resolver and the asset filter', () => {
    // The client restriction now lives in one choke point (scopedAssets ->
    // applyAssetVisibilityFilter) fed by the visibility resolver, instead of a
    // hand-rolled contacts -> client_id lookup.
    expect(source).toContain('applyAssetVisibilityFilter');
    expect(source).toContain('getClientContactVisibilityContext');
    expect(source).toContain("contactColumn: 'assets.contact_name_id'");
    expect(source).not.toContain("tenantScopedTable(trx, 'contacts', tenant)");
    expect(source).not.toContain('resolveClientId');
    // No read of `assets` bypasses scopedAssets (the only call is inside it).
    expect(source.match(/tenantScopedTable\(trx, 'assets', tenant\)/g)).toHaveLength(1);
  });

  it('F040/F081: every row read carries the assignee name and the group summary', () => {
    // `assets` holds a contact id and no group, so the portal's "Assigned to"
    // and "Shared workspace" rows need the join and the summaries.
    expect(source).toContain("'contacts.full_name as contact_name'");
    expect(source).toContain('getAssetGroupSummariesForAssets');
    expect(source).toContain('await getAssetGroupSummary(trx, tenant, assetId)');
    expect(source).toContain('withAssigneeName(trx, tenant, baseQuery())');
    expect(
      source.match(/withAssigneeName\(trx, tenant, scopedAssets\(trx, tenant, visibility\)\)/g),
    ).toHaveLength(2);
  });

  it('T059: never ships the MSP-only cost, supplier or billing columns to the portal', () => {
    // `select('assets.*')` put purchase_cost, purchase_cost_currency,
    // vendor_id, order_number and billing_profile_id in every portal payload.
    // Reads go through one allow-list now.
    expect(source).toContain('const PORTAL_ASSET_COLUMNS = [');
    expect(source).toContain('query.select(...PORTAL_ASSET_COLUMNS,');
    expect(source).not.toContain("'assets.*'");
    for (const column of [
      'purchase_cost',
      'purchase_cost_currency',
      'vendor_id',
      'vendor_name',
      'order_number',
      'billing_profile_id',
      'manufacturer',
      'model',
    ]) {
      expect(source).not.toContain(`assets.${column}`);
    }
  });

  it('sorts on qualified asset columns so the contacts join stays unambiguous', () => {
    // `contacts` has its own updated_at: an unqualified ORDER BY would be a
    // 42702 on the default sort.
    expect(source).toContain("updated_at: 'assets.updated_at'");
    expect(source).toContain(".orderBy('assets.updated_at', 'desc')");
  });
});
