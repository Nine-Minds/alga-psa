import { describe, expect, it } from 'vitest';
import { createTableListViewAdapter, type TableListLiveState } from './tableListViewAdapter';
import { buildListViewSettingsSchema } from './settingsSchema';
import { contactListViewFiltersSchema, type ContactListViewFilters } from './definitions/contacts';

const adapter = createTableListViewAdapter<ContactListViewFilters>({
  listKey: 'contacts',
  filterKeys: ['status', 'tags'],
  defaults: {
    filters: { status: 'active' },
    sort: { by: 'full_name', direction: 'asc' },
    pageSize: 10,
    columnVisibility: { name: true, email: true, phone: false },
    columnOrder: ['name', 'email'],
  },
  capturesColumns: true,
  sanitizeFilters: (filters, collector) => ({
    ...filters,
    tags: collector.keepList('tags', filters.tags, new Set(['vip'])),
  }),
});

const schema = buildListViewSettingsSchema(contactListViewFiltersSchema);

function live(overrides: Partial<TableListLiveState<ContactListViewFilters>> = {}): TableListLiveState<ContactListViewFilters> {
  return {
    filters: { status: 'inactive', tags: ['vip'], ...({ searchTerm: 'acme' } as object) },
    sort: { by: 'email', direction: 'desc' },
    pageSize: 50,
    columnSizing: { name: 240 },
    columnVisibility: { name: true, email: false, phone: true },
    columnOrder: ['phone', 'name'],
    ...overrides,
  };
}

describe('createTableListViewAdapter', () => {
  it('captures only view state, in a shape the strict schema accepts', () => {
    const captured = adapter.capture(live());
    expect(schema.safeParse(captured).success).toBe(true);
    expect(captured).toEqual({
      filters: { status: 'inactive', tags: ['vip'] },
      sort: { by: 'email', direction: 'desc' },
      columns: {
        visibility: { name: true, email: false, phone: true },
        order: ['phone', 'name'],
        sizing: { name: 240 },
      },
      pageSize: 50,
    });
  });

  it('round-trips through apply and reads as clean afterwards', () => {
    const captured = adapter.capture(live());
    const applied = adapter.apply(captured, live({ filters: {}, pageSize: 10, columnSizing: undefined }));
    expect(applied.filters).toEqual({ status: 'inactive', tags: ['vip'] });
    expect(applied.sort).toEqual({ by: 'email', direction: 'desc' });
    expect(applied.pageSize).toBe(50);
    expect(applied.columnSizing).toEqual({ name: 240 });
    expect(applied.columnOrder).toEqual(['phone', 'name']);
    expect(adapter.differs(applied, captured)).toBe(false);
  });

  it('detects drift in filters, sort, page size, widths and columns', () => {
    const captured = adapter.capture(live());
    const applied = adapter.apply(captured, live());
    expect(adapter.differs({ ...applied, filters: { status: 'all', tags: ['vip'] } }, captured)).toBe(true);
    expect(adapter.differs({ ...applied, sort: { by: 'email', direction: 'asc' } }, captured)).toBe(true);
    expect(adapter.differs({ ...applied, pageSize: 25 }, captured)).toBe(true);
    expect(adapter.differs({ ...applied, columnSizing: { name: 100 } }, captured)).toBe(true);
    expect(adapter.differs({ ...applied, columnOrder: ['name', 'phone'] }, captured)).toBe(true);
  });

  it('unsets filters a view does not name, and returns to the defaults for the baseline', () => {
    const applied = adapter.apply({ filters: { tags: ['vip'] } }, live());
    expect(applied.filters).toEqual({ status: 'active', tags: ['vip'] });
    expect(applied.columnSizing).toBeUndefined();

    const baseline = adapter.apply(null, live());
    expect(baseline.filters).toEqual({ status: 'active' });
    expect(baseline.sort).toEqual({ by: 'full_name', direction: 'asc' });
    // The baseline keeps the user's own page size.
    expect(baseline.pageSize).toBe(50);
    expect(baseline.columnOrder).toEqual(['name', 'email']);
    expect(adapter.differs(baseline, null)).toBe(false);
  });

  it('drops dead references and reports them', () => {
    const { settings, dropped } = adapter.sanitize({ filters: { status: 'all', tags: ['vip', 'gone'] } });
    expect(settings.filters).toEqual({ status: 'all', tags: ['vip'] });
    expect(dropped).toEqual([{ field: 'tags', count: 1 }]);
  });
});
