// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListViewAdapter, ListViewCollection, ListViewSettings, ListViewSummary } from '@alga-psa/types';

const actions = vi.hoisted(() => ({
  listListViews: vi.fn(),
  getListView: vi.fn(),
  createListView: vi.fn(),
  updateListView: vi.fn(),
  deleteListView: vi.fn(),
  setMyDefaultListView: vi.fn(),
}));
vi.mock('../actions/listViewActions', () => actions);

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: toastMock }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      const template = String(options?.defaultValue ?? key);
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

import { useListViews } from './useListViews';

interface Live {
  status: string;
  tags: string[];
}
type Filters = { status?: string; tags?: string[] };

const KNOWN_TAGS = new Set(['vip', 'onsite']);

const adapter: ListViewAdapter<Live, Filters> = {
  listKey: 'contacts',
  capture: (live) => ({ filters: { status: live.status, tags: live.tags } }),
  apply: (settings, live) => ({
    ...live,
    status: settings?.filters?.status ?? 'active',
    tags: settings?.filters?.tags ?? [],
  }),
  sanitize: (settings) => {
    const tags = settings.filters?.tags ?? [];
    const kept = tags.filter((tag) => KNOWN_TAGS.has(tag));
    return {
      settings: { ...settings, filters: { ...settings.filters, tags: kept } },
      dropped: kept.length === tags.length ? [] : [{ field: 'tags', count: tags.length - kept.length }],
    };
  },
  differs: (live, settings) => {
    const target = adapter.apply(settings, live);
    return target.status !== live.status || target.tags.join() !== live.tags.join();
  },
};

function view(id: string, settings: ListViewSettings<Filters>, extra: Partial<ListViewSummary<Filters>> = {}): ListViewSummary<Filters> {
  return {
    view_id: id,
    list_key: 'contacts',
    name: `View ${id}`,
    visibility: 'private',
    owner_user_id: 'me',
    owner_name: 'Me',
    settings,
    schema_version: 1,
    created_at: '2026-09-22T00:00:00.000Z',
    updated_at: '2026-09-22T00:00:00.000Z',
    isOwner: true,
    canEdit: true,
    isMyDefault: false,
    ...extra,
  };
}

const VIEW_A = '11111111-1111-4111-8111-111111111111';
const VIEW_B = '22222222-2222-4222-8222-222222222222';

function collection(overrides: Partial<ListViewCollection<Filters>> = {}): ListViewCollection<Filters> {
  return {
    views: [
      view(VIEW_A, { filters: { status: 'inactive', tags: ['vip'] } }),
      view(VIEW_B, { filters: { status: 'all', tags: ['vip', 'retired-tag'] } }),
    ],
    defaultViewId: null,
    canShare: false,
    ...overrides,
  };
}

function setUrl(search: string) {
  window.history.replaceState(null, '', `/msp/contacts${search}`);
}

function renderListViews(options: { urlHasExplicitState?: boolean } = {}) {
  const onApply = vi.fn();
  const hook = renderHook(
    ({ live }: { live: Live }) => useListViews<Live, Filters>({
      adapter,
      live,
      onApply,
      urlHasExplicitState: options.urlHasExplicitState,
    }),
    { initialProps: { live: { status: 'active', tags: [] } as Live } },
  );
  return { ...hook, onApply };
}

describe('useListViews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setUrl('');
  });

  it('applies the view named in ?view= on first load', async () => {
    actions.listListViews.mockResolvedValue(collection({ defaultViewId: VIEW_B }));
    setUrl(`?view=${VIEW_A}`);

    const { result, onApply } = renderListViews();

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenCalledWith({ status: 'inactive', tags: ['vip'] }, { viewId: VIEW_A });
    expect(result.current.activeView?.view_id).toBe(VIEW_A);
    expect(new URLSearchParams(window.location.search).get('view')).toBe(VIEW_A);
  });

  it('falls back to the personal default when the URL names no view', async () => {
    actions.listListViews.mockResolvedValue(collection({ defaultViewId: VIEW_A }));

    const { onApply } = renderListViews();

    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ status: 'inactive', tags: ['vip'] }, { viewId: VIEW_A }));
    expect(new URLSearchParams(window.location.search).get('view')).toBe(VIEW_A);
  });

  it('does not apply the personal default over a URL that already states the list', async () => {
    actions.listListViews.mockResolvedValue(collection({ defaultViewId: VIEW_A }));

    const { result, onApply } = renderListViews({ urlHasExplicitState: true });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(onApply).not.toHaveBeenCalled();
    expect(result.current.activeView).toBeNull();
  });

  it('falls back to the baseline, with a toast, for an inaccessible ?view= id', async () => {
    actions.listListViews.mockResolvedValue(collection());
    actions.getListView.mockResolvedValue({ actionError: 'This view is private or no longer exists.' });
    setUrl('?view=33333333-3333-4333-8333-333333333333&page=2');

    const { result, onApply } = renderListViews();

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('This view is private or no longer exists.'));
    expect(onApply).not.toHaveBeenCalled();
    expect(result.current.activeView).toBeNull();
    // Only the view param goes; the rest of the URL is the list's own.
    expect(window.location.search).toBe('?page=2');
  });

  it('flags drift from the applied view and discards back to it', async () => {
    actions.listListViews.mockResolvedValue(collection());
    setUrl(`?view=${VIEW_A}`);

    const { result, onApply, rerender } = renderListViews();
    await waitFor(() => expect(result.current.activeView?.view_id).toBe(VIEW_A));

    rerender({ live: { status: 'inactive', tags: ['vip'] } });
    expect(result.current.isDirty).toBe(false);

    rerender({ live: { status: 'active', tags: ['vip'] } });
    expect(result.current.isDirty).toBe(true);

    onApply.mockClear();
    act(() => result.current.discardChanges());
    expect(onApply).toHaveBeenCalledWith({ status: 'inactive', tags: ['vip'] }, { viewId: VIEW_A });
  });

  it('drops references that no longer resolve, says so, and compares against what was applied', async () => {
    actions.listListViews.mockResolvedValue(collection());

    const { result, onApply, rerender } = renderListViews();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.applyView(VIEW_B));
    expect(onApply).toHaveBeenCalledWith({ status: 'all', tags: ['vip'] }, { viewId: VIEW_B });
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('tags'));

    rerender({ live: { status: 'all', tags: ['vip'] } });
    expect(result.current.isDirty).toBe(false);
  });

  it('returns to the baseline when the applied view is deleted', async () => {
    actions.listListViews.mockResolvedValue(collection());
    actions.deleteListView.mockResolvedValue({ deleted: true });
    setUrl(`?view=${VIEW_A}`);

    const { result, onApply } = renderListViews();
    await waitFor(() => expect(result.current.activeView?.view_id).toBe(VIEW_A));

    onApply.mockClear();
    await act(async () => {
      await result.current.deleteView(VIEW_A);
    });
    expect(onApply).toHaveBeenCalledWith({ status: 'active', tags: [] }, { viewId: null });
    expect(new URLSearchParams(window.location.search).get('view')).toBeNull();
  });

  it('saves the captured live state as a new view and makes it active', async () => {
    actions.listListViews.mockResolvedValue(collection());
    const created = view('44444444-4444-4444-8444-444444444444', { filters: { status: 'all', tags: [] } }, { name: 'All contacts' });
    actions.createListView.mockResolvedValue(created);

    const { result, rerender } = renderListViews();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    rerender({ live: { status: 'all', tags: [] } });

    actions.listListViews.mockResolvedValue(collection({ views: [...collection().views, created] }));
    await act(async () => {
      await result.current.saveAsNew({ name: 'All contacts', visibility: 'private' });
    });

    expect(actions.createListView).toHaveBeenCalledWith('contacts', {
      name: 'All contacts',
      visibility: 'private',
      settings: { filters: { status: 'all', tags: [] } },
    });
    expect(result.current.activeView?.view_id).toBe(created.view_id);
    expect(result.current.isDirty).toBe(false);
  });
});

/**
 * In the app router, Next's HistoryUpdater keeps a non-null `history.state`
 * (carrying `__NA`) and re-canonicalises the URL, so a `replaceState` that
 * passes that state does not stick. Only a null-state replaceState survives.
 * These tests emulate that so they fail against the old
 * `replaceState(window.history.state, ...)` code.
 */
describe('useListViews ?view= under the Next router', () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn> | undefined;

  function setTicketsUrl(search: string) {
    window.history.replaceState(null, '', `/msp/tickets${search}`);
  }

  function emulateNextHistory() {
    const original = window.history.replaceState.bind(window.history);
    original({ __NA: true }, '', window.location.href);
    replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation((state, _title, url) => {
      const target = url == null
        ? `${window.location.pathname}${window.location.search}${window.location.hash}`
        : String(url);
      if (state === null || state === undefined) {
        original(null, '', target);
        // Next re-adds its internal state after any router-visible write.
        original({ __NA: true }, '', target);
        return;
      }
      // A state-bearing write is Next's own: it re-canonicalises the URL it knew.
    });
    return replaceStateSpy;
  }

  /** onApply that behaves like a list which mirrors its filters into the URL. */
  const listOnApply = vi.fn(() => {
    window.history.replaceState(null, '', '/msp/tickets?boardIds=x');
  });

  function renderTickets(onApply: (next: Live, meta: { viewId: string | null }) => void = listOnApply) {
    return renderHook(() => useListViews<Live, Filters>({
      adapter: { ...adapter, listKey: 'tickets' },
      live: { status: 'active', tags: [] } as Live,
      onApply,
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    replaceStateSpy?.mockRestore();
    replaceStateSpy = undefined;
  });

  it('keeps view= alongside the filters URL that onApply writes', async () => {
    actions.listListViews.mockResolvedValue(collection());
    setTicketsUrl('?boardIds=x');
    const replaceState = emulateNextHistory();

    const { result } = renderTickets();
    await waitFor(() => expect(result.current.views).toHaveLength(2));

    act(() => result.current.applyView(VIEW_A));

    expect(replaceState).toHaveBeenCalledWith(null, '', expect.any(String));
    const search = window.location.search;
    expect(new URLSearchParams(search).get('view')).toBe(VIEW_A);
    expect(new URLSearchParams(search).get('boardIds')).toBe('x');
  });

  it('drops view= after deleting the active view', async () => {
    actions.listListViews.mockResolvedValue(collection());
    actions.deleteListView.mockResolvedValue({ deleted: true });
    setTicketsUrl(`?boardIds=x&view=${VIEW_A}`);
    emulateNextHistory();

    // onApply leaves the URL alone, so writeViewParam(null) is the only writer.
    const { result } = renderTickets(vi.fn());
    await waitFor(() => expect(result.current.activeView?.view_id).toBe(VIEW_A));

    await act(async () => {
      await result.current.deleteView(VIEW_A);
    });

    expect(new URLSearchParams(window.location.search).get('view')).toBeNull();
  });

  it('drops view= when "Default view" is applied', async () => {
    actions.listListViews.mockResolvedValue(collection());
    setTicketsUrl(`?boardIds=x&view=${VIEW_A}`);
    emulateNextHistory();

    const { result } = renderTickets(vi.fn());
    await waitFor(() => expect(result.current.activeView?.view_id).toBe(VIEW_A));

    act(() => result.current.applyView(null));

    expect(new URLSearchParams(window.location.search).get('view')).toBeNull();
  });

  it('writes view= for a personal default applied on a bare list', async () => {
    actions.listListViews.mockResolvedValue(collection({ defaultViewId: VIEW_B }));
    setTicketsUrl('');
    emulateNextHistory();

    const { result } = renderTickets();

    await waitFor(() => expect(result.current.activeView?.view_id).toBe(VIEW_B));
    expect(new URLSearchParams(window.location.search).get('view')).toBe(VIEW_B);
  });
});
