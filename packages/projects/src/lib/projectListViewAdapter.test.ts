import { describe, expect, it, vi } from 'vitest';
import { buildListViewSettingsSchema, projectListViewFiltersSchema } from '@alga-psa/list-views';
import { collectViewClientIds, createProjectListViewAdapter, pickProjectViewFilters, resolveKnownClientIds } from './projectListViewAdapter';

const CLIENT = 'c0000000-0000-4000-8000-000000000001';

const adapter = createProjectListViewAdapter({
  defaultFilters: { status: 'active', projectStatus: 'open' },
  defaultSort: { by: 'created_at', direction: 'desc' },
  defaultPageSize: 10,
  known: { clientIds: new Set([CLIENT]) },
});
const schema = buildListViewSettingsSchema(projectListViewFiltersSchema);

describe('project list view adapter', () => {
  it('ignores search text and pagination when picking view filters', () => {
    expect(pickProjectViewFilters({ searchQuery: 'x', page: 3, pageSize: 25, status: 'all', tags: [] }))
      .toEqual({ status: 'all' });
  });

  it('round-trips filters, sort and page size; differs flags drift', () => {
    const live = {
      filters: { status: 'all' as const, projectStatus: 'closed', clientId: CLIENT, tags: ['migration'], deadlineType: 'before' as const, deadlineDate: '2026-10-01' },
      sort: { by: 'project_name', direction: 'asc' as const },
      pageSize: 25,
      columnSizing: { project_name: 300 },
    };
    const captured = adapter.capture(live);
    expect(schema.safeParse(captured).success).toBe(true);

    const applied = adapter.apply(captured, { ...live, filters: { status: 'active' }, pageSize: 10 });
    expect(applied.filters).toEqual(live.filters);
    expect(applied.sort).toEqual(live.sort);
    expect(applied.pageSize).toBe(25);
    expect(adapter.differs(applied, captured)).toBe(false);
    expect(adapter.differs({ ...applied, filters: { ...applied.filters, managerId: 'u1' } }, captured)).toBe(true);
  });

  it('drops a client that no longer exists', () => {
    const { settings, dropped } = adapter.sanitize({ filters: { clientId: 'c-deleted', status: 'all' } });
    expect(settings.filters).toEqual({ status: 'all' });
    expect(dropped).toEqual([{ field: 'clientId', count: 1 }]);
  });
});

describe('saved-view client verification', () => {
  const live = { c1: 'c-live', c2: 'c-deleted' };

  it('collects distinct client ids referenced by views', () => {
    expect(collectViewClientIds([
      { settings: { filters: { clientId: live.c1 } } },
      { settings: { filters: { clientId: live.c1 } } },
      { settings: { filters: {} } },
      { settings: {} },
      { settings: { filters: { clientId: live.c2 } } },
    ])).toEqual([live.c1, live.c2]);
  });

  it('looks up only the referenced ids and drops a deleted client filter', async () => {
    const lookup = vi.fn(async (ids: string[]) => ids.filter((id) => id === live.c1));
    const known = await resolveKnownClientIds([live.c1, live.c2], lookup);
    expect(lookup).toHaveBeenCalledWith([live.c1, live.c2]);

    const checked = createProjectListViewAdapter({
      defaultFilters: { status: 'active', projectStatus: 'open' },
      defaultSort: { by: 'created_at', direction: 'desc' },
      defaultPageSize: 10,
      known: { clientIds: known },
    });
    expect(checked.sanitize({ filters: { clientId: live.c1 } }).settings.filters?.clientId).toBe(live.c1);
    const dropped = checked.sanitize({ filters: { clientId: live.c2 } });
    expect(dropped.settings.filters?.clientId).toBeUndefined();
    expect(dropped.dropped.map((d) => d.field)).toEqual(['clientId']);
  });

  it('skips the lookup when no view references a client', async () => {
    const lookup = vi.fn();
    expect((await resolveKnownClientIds([], lookup)).size).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('keeps the references when the lookup fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const known = await resolveKnownClientIds([live.c1], async () => { throw new Error('denied'); });
    expect(known.has(live.c1)).toBe(true);
    spy.mockRestore();
  });
});
