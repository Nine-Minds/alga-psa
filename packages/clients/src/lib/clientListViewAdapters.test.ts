import { describe, expect, it } from 'vitest';
import {
  buildListViewSettingsSchema,
  clientListViewFiltersSchema,
  contactListViewFiltersSchema,
} from '@alga-psa/list-views';
import { createClientListViewAdapter, createContactListViewAdapter } from './clientListViewAdapters';

describe('client list view adapter', () => {
  const adapter = createClientListViewAdapter({ defaultPageSize: 10, knownTags: new Set(['vip', 'msp']) });
  const schema = buildListViewSettingsSchema(clientListViewFiltersSchema);

  it('round-trips filters, sort, page size and widths', () => {
    const live = {
      filters: { status: 'all' as const, clientType: 'company' as const, lifecycle: 'prospect' as const, tags: ['vip'] },
      sort: { by: 'created_at', direction: 'desc' as const },
      pageSize: 50,
      columnSizing: { client_name: 280 },
    };
    const captured = adapter.capture(live);
    expect(schema.safeParse(captured).success).toBe(true);
    const applied = adapter.apply(captured, { ...live, filters: {}, pageSize: 10, columnSizing: undefined });
    expect(applied).toEqual({ ...live, columnVisibility: undefined, columnOrder: undefined });
    expect(adapter.differs(applied, captured)).toBe(false);
    expect(adapter.differs({ ...applied, filters: { ...applied.filters, lifecycle: 'former' } }, captured)).toBe(true);
  });

  it('drops tags that no longer exist but keeps them while tags are still loading', () => {
    expect(adapter.sanitize({ filters: { tags: ['vip', 'gone'] } }).settings.filters).toEqual({ tags: ['vip'] });
    const loading = createClientListViewAdapter({ defaultPageSize: 10 });
    expect(loading.sanitize({ filters: { tags: ['vip', 'gone'] } }).dropped).toEqual([]);
  });
});

describe('contact list view adapter', () => {
  const adapter = createContactListViewAdapter({ defaultPageSize: 10, knownTags: new Set(['vip']) });
  const schema = buildListViewSettingsSchema(contactListViewFiltersSchema);

  it('round-trips and flags drift; the baseline is active contacts by name', () => {
    const live = {
      filters: { status: 'inactive' as const, tags: ['vip'] },
      sort: { by: 'email', direction: 'desc' as const },
      pageSize: 25,
    };
    const captured = adapter.capture(live);
    expect(schema.safeParse(captured).success).toBe(true);
    const applied = adapter.apply(captured, { ...live, filters: {} });
    expect(adapter.differs(applied, captured)).toBe(false);
    expect(adapter.differs({ ...applied, sort: { by: 'full_name', direction: 'asc' } }, captured)).toBe(true);

    const baseline = adapter.apply(null, live);
    expect(baseline.filters).toEqual({ status: 'active' });
    expect(baseline.sort).toEqual({ by: 'full_name', direction: 'asc' });
  });
});
