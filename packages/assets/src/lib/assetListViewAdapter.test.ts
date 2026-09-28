import { describe, expect, it } from 'vitest';
import { assetListViewFiltersSchema, buildListViewSettingsSchema } from '@alga-psa/list-views';
import {
  assetColumnsFromView,
  assetColumnsToView,
  createAssetListViewAdapter,
} from './assetListViewAdapter';

const ALL = ['select', 'name', 'asset_tag', 'status', 'client_name', 'actions'] as const;
const DEFAULT = ['select', 'name', 'client_name', 'actions'] as const;
const CLIENT = 'c0000000-0000-4000-8000-000000000001';

const adapter = createAssetListViewAdapter({
  defaultPageSize: 10,
  defaultColumns: assetColumnsToView(DEFAULT, ALL),
  knownClientIds: new Set([CLIENT]),
});
const schema = buildListViewSettingsSchema(assetListViewFiltersSchema);

describe('asset list view adapter', () => {
  it('round-trips filter chips, sort, page size and the column chooser', () => {
    const live = {
      filters: { statuses: ['active'], types: ['server'], clientIds: [CLIENT], agentStatuses: ['offline'], rmmManaged: ['managed'] },
      sort: { by: 'name', direction: 'asc' as const },
      pageSize: 25,
      columnSizing: { name: 260 },
      ...assetColumnsToView(['name', 'status', 'asset_tag'], ALL),
    };
    const captured = adapter.capture(live);
    expect(schema.safeParse(captured).success).toBe(true);

    const applied = adapter.apply(captured, { ...live, filters: {}, ...assetColumnsToView(DEFAULT, ALL) });
    expect(applied.filters).toEqual(live.filters);
    expect(assetColumnsFromView(applied.columnVisibility, applied.columnOrder, ALL, DEFAULT))
      .toEqual(['name', 'status', 'asset_tag']);
    expect(adapter.differs(applied, captured)).toBe(false);
    expect(adapter.differs({ ...applied, ...assetColumnsToView(['name', 'asset_tag', 'status'], ALL) }, captured)).toBe(true);
  });

  it('restores the default columns for the baseline and ignores retired columns', () => {
    const baseline = adapter.apply(null, {
      filters: { statuses: ['active'] },
      sort: { by: 'name', direction: 'asc' },
      pageSize: 50,
    });
    expect(baseline.filters).toEqual({});
    expect(assetColumnsFromView(baseline.columnVisibility, baseline.columnOrder, ALL, DEFAULT)).toEqual([...DEFAULT]);

    expect(assetColumnsFromView({ retired: true, name: true }, ['retired', 'name'], ALL, DEFAULT)).toEqual(['name']);
    expect(assetColumnsFromView({ name: false }, [], ALL, DEFAULT)).toEqual([...DEFAULT]);
  });

  it('drops clients that no longer exist', () => {
    const { settings, dropped } = adapter.sanitize({ filters: { clientIds: [CLIENT, 'c-gone'] } });
    expect(settings.filters).toEqual({ clientIds: [CLIENT] });
    expect(dropped).toEqual([{ field: 'clientIds', count: 1 }]);
  });
});
