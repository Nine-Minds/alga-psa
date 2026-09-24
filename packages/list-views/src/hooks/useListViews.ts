'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type {
  ListViewAdapter,
  ListViewCollection,
  ListViewSettings,
  ListViewSummary,
  ListViewVisibility,
} from '@alga-psa/types';
import {
  createListView,
  deleteListView,
  getListView,
  listListViews,
  setMyDefaultListView,
  updateListView,
} from '../actions/listViewActions';
import { LIST_VIEW_URL_PARAM } from '../lib/registry';

/**
 * Everything a list screen needs to support named views, so that screens
 * provide only their live state and a setter and never re-implement any of it:
 *
 *  - loading the list's views (the caller's private ones + every shared one);
 *  - resolving the view to open with, once: `?view=<id>` → the user's default
 *    (unless the URL already states the list's filters) → the baseline;
 *  - apply (sanitize → toast what was dropped → adapter.apply), save changes,
 *    save as new, rename / re-scope, delete, set/clear the personal default,
 *    discard;
 *  - the dirty flag, via adapter.differs;
 *  - keeping `?view=<id>` in the address bar in step with the applied view.
 */

export interface UseListViewsOptions<TLive, F> {
  adapter: ListViewAdapter<TLive, F>;
  /** The list's live state, as the adapter understands it. */
  live: TLive;
  /**
   * Replaces the list's live state (a view, or the baseline when `viewId` is
   * null). When `ownsUrl` is set, the list is also the URL writer: it must
   * write one URL — the applied filters plus `?view=<meta.viewId>` — here.
   */
  onApply: (next: TLive, meta: { viewId: string | null }) => void;
  /**
   * The URL the list was opened with already expresses the list's state
   * (explicit filter params). A personal default must not override a link.
   */
  urlHasExplicitState?: boolean;
  /**
   * The list mirrors its full state (filters and `?view=`) into the address bar
   * itself, so it must be the only writer. When true, the hook never rewrites
   * `?view=` on an apply: `onApply` receives the `viewId` and writes the single,
   * router-authoritative URL. This matters because the patched `history`
   * `replaceState` turns every null-state call into a router action, and a
   * filter write immediately followed by a second view write races itself and
   * can settle on the older URL. Lists that carry only `?view=` (Clients,
   * Contacts, Assets) leave this off and the hook writes the parameter for them.
   */
  // LEVERAGE: friction list-view-url-ownership — URL ownership is split between
  // this hook and each list (lists that mirror filters opt into `ownsUrl` and
  // write `?view=` themselves; the rest let the hook append it). Two writers for
  // one address bar race Next's action queue. Collapse to a single list-URL
  // writer once the list-query state machine has one home.
  ownsUrl?: boolean;
  /** Hold off first-load resolution until the list can apply a view (e.g. options loaded). */
  ready?: boolean;
}

export interface ListViewsController<F = Record<string, unknown>> {
  isLoading: boolean;
  views: ListViewSummary<F>[];
  myViews: ListViewSummary<F>[];
  sharedViews: ListViewSummary<F>[];
  activeView: ListViewSummary<F> | null;
  defaultViewId: string | null;
  canShare: boolean;
  /** A view is applied and the live list has drifted from it. */
  isDirty: boolean;
  isSaving: boolean;
  applyView: (viewId: string | null) => void;
  discardChanges: () => void;
  saveChanges: () => Promise<boolean>;
  saveAsNew: (input: { name: string; visibility: ListViewVisibility }) => Promise<boolean>;
  updateView: (viewId: string, patch: { name?: string; visibility?: ListViewVisibility }) => Promise<boolean>;
  deleteView: (viewId: string) => Promise<boolean>;
  setDefault: (viewId: string | null) => Promise<boolean>;
  /** Absolute link that opens the list with a view applied. */
  linkFor: (viewId: string) => string;
}

type ActionResult<T> = T | { actionError: string } | { permissionError: string };

function isFailure(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function readViewParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(LIST_VIEW_URL_PARAM);
}

/**
 * Rewrite only the `view` parameter, preserving whatever else the list keeps
 * in the address bar (tickets and projects mirror their filters there).
 */
export function writeViewParam(viewId: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (viewId) {
    url.searchParams.set(LIST_VIEW_URL_PARAM, viewId);
  } else {
    url.searchParams.delete(LIST_VIEW_URL_PARAM);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.replaceState(null, '', next);
  }
}

export function useListViews<TLive, F = Record<string, unknown>>({
  adapter,
  live,
  onApply,
  urlHasExplicitState = false,
  ownsUrl = false,
  ready = true,
}: UseListViewsOptions<TLive, F>): ListViewsController<F> {
  const { t } = useTranslation('common');
  const [collection, setCollection] = useState<ListViewCollection<F> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  /** The settings actually applied (post-sanitize) — what the dirty check compares against. */
  const [appliedSettings, setAppliedSettings] = useState<ListViewSettings<F> | null>(null);

  const liveRef = useRef(live);
  liveRef.current = live;
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const resolvedInitialRef = useRef(false);
  const urlHasExplicitStateRef = useRef(urlHasExplicitState);
  const ownsUrlRef = useRef(ownsUrl);
  ownsUrlRef.current = ownsUrl;

  const reportFailure = useCallback((result: unknown, fallbackKey: string, fallback: string) => {
    const message = isFailure(result) ? getErrorMessage(result) : null;
    toast.error(message || t(fallbackKey, fallback));
  }, [t]);

  const refresh = useCallback(async (): Promise<ListViewCollection<F> | null> => {
    try {
      const result = (await listListViews(adapterRef.current.listKey)) as ActionResult<ListViewCollection<F>>;
      if (isFailure(result)) {
        // No access to views on this list: the picker simply has nothing to show.
        setCollection({ views: [], defaultViewId: null, canShare: false });
        return null;
      }
      setCollection(result);
      return result;
    } catch (error) {
      console.error('[listViews] failed to load views', error);
      setCollection({ views: [], defaultViewId: null, canShare: false });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applySummary = useCallback((view: ListViewSummary<F> | null) => {
    const currentAdapter = adapterRef.current;
    // A list that owns its URL writes the applied filters and `view=` together in
    // onApply; writing here too would be the second, racing history write this
    // option exists to remove.
    const listWritesUrl = ownsUrlRef.current;
    if (!view) {
      onApplyRef.current(currentAdapter.apply(null, liveRef.current), { viewId: null });
      setActiveViewId(null);
      setAppliedSettings(null);
      if (!listWritesUrl) writeViewParam(null);
      return;
    }
    const { settings, dropped } = currentAdapter.sanitize(view.settings);
    if (dropped.length > 0) {
      const fields = dropped.map((entry) => entry.field).join(', ');
      toast(t('listViews.toasts.droppedReferences', {
        defaultValue: 'Some items in "{{name}}" no longer exist and were skipped: {{fields}}',
        name: view.name,
        fields,
      }));
    }
    onApplyRef.current(currentAdapter.apply(settings, liveRef.current), { viewId: view.view_id });
    setActiveViewId(view.view_id);
    setAppliedSettings(settings);
    if (!listWritesUrl) writeViewParam(view.view_id);
  }, [t]);

  // First-load resolution: `?view=` → personal default → baseline. Runs once.
  useEffect(() => {
    if (resolvedInitialRef.current || !collection || !ready) return;
    resolvedInitialRef.current = true;

    const requested = readViewParam();
    if (requested) {
      const listed = collection.views.find((view) => view.view_id === requested);
      if (listed) {
        applySummary(listed);
        return;
      }
      void (async () => {
        const result = (await getListView(requested)) as ActionResult<ListViewSummary<F>>;
        if (!isFailure(result) && result.list_key === adapterRef.current.listKey) {
          applySummary(result);
          return;
        }
        toast.error(t('listViews.errors.notFound', 'This view is private or no longer exists.'));
        writeViewParam(null);
      })();
      return;
    }

    if (collection.defaultViewId && !urlHasExplicitStateRef.current) {
      const fallback = collection.views.find((view) => view.view_id === collection.defaultViewId);
      if (fallback) applySummary(fallback);
    }
  }, [collection, ready, applySummary, t]);

  const views = useMemo(() => collection?.views ?? [], [collection]);
  const activeView = useMemo(
    () => views.find((view) => view.view_id === activeViewId) ?? null,
    [views, activeViewId]
  );
  const myViews = useMemo(() => views.filter((view) => view.isOwner && view.visibility === 'private'), [views]);
  const sharedViews = useMemo(() => views.filter((view) => view.visibility === 'shared'), [views]);

  const isDirty = useMemo(
    () => (activeViewId !== null && appliedSettings !== null ? adapter.differs(live, appliedSettings) : false),
    [adapter, live, activeViewId, appliedSettings]
  );

  const applyView = useCallback((viewId: string | null) => {
    if (viewId === null) {
      applySummary(null);
      return;
    }
    const view = views.find((candidate) => candidate.view_id === viewId);
    if (view) applySummary(view);
  }, [applySummary, views]);

  const discardChanges = useCallback(() => {
    if (activeView) applySummary(activeView);
  }, [activeView, applySummary]);

  const withSaving = useCallback(async (run: () => Promise<boolean>): Promise<boolean> => {
    setIsSaving(true);
    try {
      return await run();
    } catch (error) {
      console.error('[listViews] action failed', error);
      toast.error(t('listViews.errors.saveFailed', 'The view could not be saved.'));
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [t]);

  const saveChanges = useCallback(() => withSaving(async () => {
    if (!activeView) return false;
    const settings = adapterRef.current.capture(liveRef.current);
    const result = (await updateListView(activeView.view_id, {
      settings: settings as ListViewSettings,
    })) as ActionResult<ListViewSummary<F>>;
    if (isFailure(result)) {
      reportFailure(result, 'listViews.errors.saveFailed', 'The view could not be saved.');
      return false;
    }
    setAppliedSettings(result.settings);
    await refresh();
    toast.success(t('listViews.toasts.saved', { defaultValue: 'Saved "{{name}}"', name: result.name }));
    return true;
  }), [activeView, refresh, reportFailure, t, withSaving]);

  const saveAsNew = useCallback((input: { name: string; visibility: ListViewVisibility }) => withSaving(async () => {
    const settings = adapterRef.current.capture(liveRef.current);
    const result = (await createListView(adapterRef.current.listKey, {
      name: input.name,
      visibility: input.visibility,
      settings: settings as ListViewSettings,
    })) as ActionResult<ListViewSummary<F>>;
    if (isFailure(result)) {
      reportFailure(result, 'listViews.errors.saveFailed', 'The view could not be saved.');
      return false;
    }
    await refresh();
    setActiveViewId(result.view_id);
    setAppliedSettings(result.settings);
    writeViewParam(result.view_id);
    toast.success(t('listViews.toasts.saved', { defaultValue: 'Saved "{{name}}"', name: result.name }));
    return true;
  }), [refresh, reportFailure, t, withSaving]);

  const updateView = useCallback((viewId: string, patch: { name?: string; visibility?: ListViewVisibility }) => withSaving(async () => {
    const result = (await updateListView(viewId, patch)) as ActionResult<ListViewSummary<F>>;
    if (isFailure(result)) {
      reportFailure(result, 'listViews.errors.saveFailed', 'The view could not be saved.');
      return false;
    }
    await refresh();
    toast.success(t('listViews.toasts.updated', { defaultValue: 'Updated "{{name}}"', name: result.name }));
    return true;
  }), [refresh, reportFailure, t, withSaving]);

  const deleteView = useCallback((viewId: string) => withSaving(async () => {
    const result = (await deleteListView(viewId)) as ActionResult<{ deleted: true }>;
    if (isFailure(result)) {
      reportFailure(result, 'listViews.errors.deleteFailed', 'The view could not be deleted.');
      return false;
    }
    if (viewId === activeViewId) {
      // The list was showing the view that just went away: back to the baseline.
      applySummary(null);
    }
    await refresh();
    toast.success(t('listViews.toasts.deleted', 'View deleted'));
    return true;
  }), [activeViewId, applySummary, refresh, reportFailure, t, withSaving]);

  const setDefault = useCallback((viewId: string | null) => withSaving(async () => {
    const result = (await setMyDefaultListView(adapterRef.current.listKey, viewId)) as ActionResult<{ defaultViewId: string | null }>;
    if (isFailure(result)) {
      reportFailure(result, 'listViews.errors.defaultFailed', 'Your default view could not be changed.');
      return false;
    }
    await refresh();
    toast.success(viewId
      ? t('listViews.toasts.defaultSet', 'Default view set')
      : t('listViews.toasts.defaultCleared', 'Default view cleared'));
    return true;
  }), [refresh, reportFailure, t, withSaving]);

  const linkFor = useCallback((viewId: string) => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set(LIST_VIEW_URL_PARAM, viewId);
    return url.toString();
  }, []);

  return {
    isLoading,
    views,
    myViews,
    sharedViews,
    activeView,
    defaultViewId: collection?.defaultViewId ?? null,
    canShare: collection?.canShare ?? false,
    isDirty,
    isSaving,
    applyView,
    discardChanges,
    saveChanges,
    saveAsNew,
    updateView,
    deleteView,
    setDefault,
    linkFor,
  };
}
