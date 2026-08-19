// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { ITicketListFilters } from '@alga-psa/types';
import {
  buildBoardArrivalFilters,
  CAPTURE_EXCLUDED_FILTER_KEYS,
  captureTicketViewSettings,
  resolveTicketViewSettings,
  ticketViewDiffersFromSaved,
  validateCapturedFilters,
  TICKET_VIEW_DENSITY_DEFAULT,
  type TicketViewSettings,
} from './ticketViewSettings';
import { resolveTicketColumnOrder, TICKET_COLUMNS } from './ticketColumnCatalog';

const CATALOG_KEYS = TICKET_COLUMNS.map((column) => column.key);

describe('resolveTicketViewSettings', () => {
  it('prefers the board layer over the tenant layer over the catalog', () => {
    const resolved = resolveTicketViewSettings({
      board: { densityLevel: 20 },
      tenant: { densityLevel: 80, tagsInlineUnderTitle: false },
    });

    expect(resolved.densityLevel).toBe(20);        // board
    expect(resolved.tagsInlineUnderTitle).toBe(false); // tenant, board silent
    // catalog: no layer expressed visibility, so defaults apply per key
    expect(resolved.columnVisibility.status).toBe(true);
    expect(resolved.columnVisibility.created_by).toBe(false);
  });

  it('falls through cleanly when the board has no stored document at all', () => {
    // NULL list_view_settings is the reset state, and it must behave exactly as
    // if the board had never been configured — not as an empty override.
    const tenant: TicketViewSettings = { densityLevel: 30, columnVisibility: { created_by: true } };

    const withNull = resolveTicketViewSettings({ board: null, tenant });
    const withUndefined = resolveTicketViewSettings({ board: undefined, tenant });

    expect(withNull).toEqual(withUndefined);
    expect(withNull.densityLevel).toBe(30);
    expect(withNull.columnVisibility.created_by).toBe(true);
  });

  it('replaces a group wholesale rather than deep-merging it', () => {
    // The board hides `status` and says nothing about `created_by`. Because
    // capture always writes a complete map, the board's map is the whole answer:
    // the tenant's created_by:true must NOT leak through per-key.
    const resolved = resolveTicketViewSettings({
      board: { columnVisibility: { status: false } },
      tenant: { columnVisibility: { created_by: true, status: true } },
    });

    expect(resolved.columnVisibility.status).toBe(false);
    expect(resolved.columnVisibility.created_by).toBe(false); // catalog default, not tenant's true
  });

  it('replaces the filter group wholesale too', () => {
    const resolved = resolveTicketViewSettings({
      board: { filters: { priorityId: 'high' } },
      tenant: { filters: { clientId: 'client-1', priorityId: 'low' } },
    });

    expect(resolved.filters).toEqual({ priorityId: 'high' });
  });

  it('defaults density to 50 and snaps a stored value to the slider step', () => {
    expect(resolveTicketViewSettings({}).densityLevel).toBe(TICKET_VIEW_DENSITY_DEFAULT);
    expect(resolveTicketViewSettings({ board: { densityLevel: 34 } }).densityLevel).toBe(30);
    expect(resolveTicketViewSettings({ board: { densityLevel: 999 } }).densityLevel).toBe(100);
  });
});

describe('resolveTicketColumnOrder', () => {
  it('honours the stored order for the keys it names', () => {
    const order = resolveTicketColumnOrder(['client', 'status']);
    expect(order.slice(0, 2)).toEqual(['client', 'status']);
  });

  it('drops stored keys the catalog no longer knows', () => {
    const order = resolveTicketColumnOrder(['client', 'a_column_that_was_deleted', 'status']);
    expect(order).not.toContain('a_column_that_was_deleted');
    expect(order.slice(0, 2)).toEqual(['client', 'status']);
  });

  it('still surfaces a catalog key that was added after the view was saved', () => {
    // The whole point: a board's saved order is a preference about the columns
    // it names, never an exhaustive declaration of the column set. A column
    // added later must appear rather than silently vanish for that board.
    const savedBeforeCreatedByExisted = ['title', 'status'];
    const order = resolveTicketColumnOrder(savedBeforeCreatedByExisted);

    expect(order).toContain('created_by');
    expect(new Set(order)).toEqual(new Set(CATALOG_KEYS));
  });

  it('appends the unnamed remainder in catalog order', () => {
    const order = resolveTicketColumnOrder(['due_date']);
    const remainder = order.slice(1);
    const expectedRemainder = CATALOG_KEYS.filter((key) => key !== 'due_date');
    expect(remainder).toEqual(expectedRemainder);
  });

  it('returns the full catalog order for an absent or empty stored order', () => {
    expect(resolveTicketColumnOrder()).toEqual(CATALOG_KEYS);
    expect(resolveTicketColumnOrder([])).toEqual(CATALOG_KEYS);
    expect(resolveTicketColumnOrder(null)).toEqual(CATALOG_KEYS);
  });

  it('de-duplicates a stored order that names a key twice', () => {
    const order = resolveTicketColumnOrder(['status', 'status', 'client']);
    expect(order.slice(0, 2)).toEqual(['status', 'client']);
    expect(order).toHaveLength(CATALOG_KEYS.length);
  });
});

describe('captureTicketViewSettings', () => {
  const liveFilters: Partial<ITicketListFilters> = {
    // Excluded — board scope is the tab, and search is transient.
    boardId: 'legacy-board',
    boardIds: ['board-1'],
    excludeBoardIds: ['board-2'],
    boardFilterState: 'all',
    searchQuery: 'printer on fire',
    // Included.
    statusId: 'status-1',
    priorityId: 'priority-1',
    categoryIds: ['category-1'],
    clientId: 'client-1',
    tags: ['urgent'],
    assignedToIds: ['user-1'],
    assignedTeamIds: ['team-1'],
    includeUnassigned: true,
    assignedToMe: true,
    dueDateFilter: 'overdue',
    responseState: 'awaiting_client',
    slaStatusFilter: 'breached',
    showOpenOnly: true,
    bundleView: 'individual',
    sortBy: 'due_date',
    sortDirection: 'asc',
  };

  it('strips every excluded key and nothing else', () => {
    const captured = captureTicketViewSettings({ filters: liveFilters });

    for (const key of CAPTURE_EXCLUDED_FILTER_KEYS) {
      expect(captured.filters).not.toHaveProperty(key);
    }

    const expectedKeys = Object.keys(liveFilters)
      .filter((key) => !(CAPTURE_EXCLUDED_FILTER_KEYS as readonly string[]).includes(key))
      .sort();
    expect(Object.keys(captured.filters ?? {}).sort()).toEqual(expectedKeys);
  });

  it('captures sort as part of the filters rather than as a second representation', () => {
    const captured = captureTicketViewSettings({ filters: liveFilters });
    expect(captured.filters?.sortBy).toBe('due_date');
    expect(captured.filters?.sortDirection).toBe('asc');
  });

  it('round-trips every included value unchanged', () => {
    const captured = captureTicketViewSettings({ filters: liveFilters });
    for (const [key, value] of Object.entries(captured.filters ?? {})) {
      expect(value).toEqual(liveFilters[key as keyof ITicketListFilters]);
    }
  });

  it('survives a full round trip back through the resolver', () => {
    const captured = captureTicketViewSettings({
      filters: liveFilters,
      columnVisibility: { created_by: true },
      columnOrder: ['client', 'status'],
      densityLevel: 30,
    });
    const resolved = resolveTicketViewSettings({ board: captured, tenant: null });

    expect(resolved.densityLevel).toBe(30);
    expect(resolved.columnVisibility.created_by).toBe(true);
    expect(resolved.columnOrder.slice(0, 2)).toEqual(['client', 'status']);
    expect(resolved.filters.priorityId).toBe('priority-1');
  });

  it('omits a boolean filter that is off, because off is not a constraint', () => {
    // Storing includeUnassigned:false would record "do not include unassigned"
    // as a positive choice, which is both wrong and enough to make an
    // unconfigured board compare as different from its own defaults.
    const captured = captureTicketViewSettings({
      filters: { statusId: 'status-1', includeUnassigned: false, assignedToMe: false },
    });
    expect(captured.filters).toEqual({ statusId: 'status-1' });

    // ...but the same flags survive when they are on.
    const on = captureTicketViewSettings({
      filters: { includeUnassigned: true, assignedToMe: true },
    });
    expect(on.filters).toEqual({ includeUnassigned: true, assignedToMe: true });
  });

  it('keeps showOpenOnly:false, where false is a real constraint', () => {
    const captured = captureTicketViewSettings({ filters: { showOpenOnly: false } });
    expect(captured.filters).toEqual({ showOpenOnly: false });
  });

  it('omits empty and absent values so a saved view stays readable', () => {
    const captured = captureTicketViewSettings({
      filters: { statusId: 'status-1', tags: [], assignedToIds: undefined },
    });
    expect(captured.filters).toEqual({ statusId: 'status-1' });
  });
});

describe('validateCapturedFilters (validate-on-read)', () => {
  it('drops a statusId that no longer exists', () => {
    // The board's saved view names a status that has since been deleted.
    // Applying it verbatim would produce an empty list on a board that has
    // tickets — which reads as a bug rather than as stale configuration.
    const validated = validateCapturedFilters(
      { statusId: 'deleted-status', priorityId: 'priority-1' },
      { statusIds: ['status-1', 'status-2'], priorityIds: ['priority-1'] },
    );

    expect(validated).not.toHaveProperty('statusId');
    expect(validated.priorityId).toBe('priority-1');
  });

  it('does not produce an empty list — the dead key is absent, not falsy', () => {
    const validated = validateCapturedFilters({ statusId: 'gone' }, { statusIds: ['live'] });
    expect(Object.prototype.hasOwnProperty.call(validated, 'statusId')).toBe(false);
  });

  it('keeps sentinel pseudo-filters that are not ids', () => {
    const validated = validateCapturedFilters(
      { statusId: 'open', priorityId: 'all' },
      { statusIds: ['status-1'], priorityIds: ['priority-1'] },
      ['open', 'all'],
    );
    expect(validated.statusId).toBe('open');
    expect(validated.priorityId).toBe('all');
  });

  it('drops only the dead members of a list, keeping the live ones', () => {
    const validated = validateCapturedFilters(
      { assignedToIds: ['user-1', 'user-gone', 'user-2'] },
      { userIds: ['user-1', 'user-2'] },
    );
    expect(validated.assignedToIds).toEqual(['user-1', 'user-2']);
  });

  it('drops a list entirely when nothing in it survives', () => {
    const validated = validateCapturedFilters(
      { assignedToIds: ['user-gone'] },
      { userIds: ['user-1'] },
    );
    expect(validated).not.toHaveProperty('assignedToIds');
  });

  it('leaves a value alone when its universe is unknown', () => {
    // "Cannot validate" must never mean "drop" — an unloaded option list would
    // otherwise silently erase a perfectly good saved filter.
    const validated = validateCapturedFilters({ clientId: 'client-1' }, {});
    expect(validated.clientId).toBe('client-1');
  });

  it('leaves non-id filters untouched', () => {
    const validated = validateCapturedFilters(
      { slaStatusFilter: 'breached', dueDateFilter: 'overdue', showOpenOnly: true },
      { statusIds: [] },
    );
    expect(validated.slaStatusFilter).toBe('breached');
    expect(validated.dueDateFilter).toBe('overdue');
    expect(validated.showOpenOnly).toBe(true);
  });
});

describe('buildBoardArrivalFilters', () => {
  const baseline: Partial<ITicketListFilters> = {
    statusId: 'open',
    priorityId: 'all',
    boardFilterState: 'active',
    showOpenOnly: true,
  };
  const boardSelection: Partial<ITicketListFilters> = {
    boardId: undefined,
    boardIds: ['board-1'],
    statusId: 'open',
    showOpenOnly: true,
  };

  it('replaces the previous board’s filters rather than refining them', () => {
    // Arriving from a board whose view set priorityId=high must not leave that
    // behind on a board that says nothing about priority.
    const arrival = buildBoardArrivalFilters({
      baseline,
      boardSelection,
      viewFilters: { statusId: 'status-triage' },
    });

    expect(arrival.priorityId).toBe('all');
    expect(arrival.statusId).toBe('status-triage');
  });

  it('lets board scope come only from the selection, never from the stored view', () => {
    // Belt to capture's braces: even a hand-written document must not be able to
    // make a board's default view navigate to a different board.
    const arrival = buildBoardArrivalFilters({
      baseline,
      boardSelection,
      viewFilters: {
        boardIds: ['some-other-board'],
        excludeBoardIds: ['board-1'],
        searchQuery: 'sticky',
      } as Partial<ITicketListFilters>,
    });

    expect(arrival.boardIds).toEqual(['board-1']);
    expect(arrival.excludeBoardIds).toBeUndefined();
    expect(arrival.searchQuery).toBeUndefined();
  });

  it('lets the stored view outrank the generic status reconciliation', () => {
    const arrival = buildBoardArrivalFilters({
      baseline,
      boardSelection,
      viewFilters: { statusId: 'status-waiting', sortBy: 'due_date', sortDirection: 'asc' },
    });

    expect(arrival.statusId).toBe('status-waiting');
    expect(arrival.sortBy).toBe('due_date');
    expect(arrival.sortDirection).toBe('asc');
  });
});

describe('ticketViewDiffersFromSaved', () => {
  it('is false when the live view matches what is stored', () => {
    const saved: TicketViewSettings = { densityLevel: 30, filters: { priorityId: 'high' } };
    expect(ticketViewDiffersFromSaved({ ...saved }, saved)).toBe(false);
  });

  it('ignores excluded keys, so a search or a board scope never looks dirty', () => {
    const saved: TicketViewSettings = { filters: { priorityId: 'high' } };
    const live: TicketViewSettings = {
      filters: { priorityId: 'high', searchQuery: 'typing', boardIds: ['board-1'] },
    };
    expect(ticketViewDiffersFromSaved(live, saved)).toBe(false);
  });

  it('is true when a stored board view exists and the live view diverges', () => {
    expect(ticketViewDiffersFromSaved(
      { densityLevel: 30 },
      { densityLevel: 50 },
    )).toBe(true);
  });

  it('is true against a null saved view once the user has arranged anything', () => {
    expect(ticketViewDiffersFromSaved({ densityLevel: 30 }, null)).toBe(true);
  });
});
