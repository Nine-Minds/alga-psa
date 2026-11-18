'use client';

import { useMemo, useRef } from 'react';
import type { PartialBlock } from '@blocknote/core';
import type { CannedResponseMergeContext, CannedResponsePickerItem } from '@alga-psa/types';
import type { EditorSnippet, EditorSnippetsConfig } from '@alga-psa/ui/editor/snippets';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getCannedResponseMergeContext,
  listVisibleCannedResponses,
  recordCannedResponseUse,
  searchCannedResponses,
} from '../../actions/cannedResponseActions';
import { resolveMergeFieldsInNote } from '../../lib/cannedResponses/mergeFields';
import { useCannedResponsePermissions } from './useCannedResponsePermissions';

// LEVERAGE: pattern action-result-unwrap — same throw-on-error-payload shape as unwrapRecurring in components/recurring/recurringUi.ts; a shared unwrapActionResult in ui/lib/errorHandling would serve both
function unwrapResult<T>(result: T): T {
  if (isActionMessageError(result)) throw new Error(result.actionError);
  if (isActionPermissionError(result)) throw new Error(result.permissionError);
  return result;
}

const toSnippet = (item: CannedResponsePickerItem): EditorSnippet => ({
  id: item.canned_response_id,
  title: item.name,
  category: item.category,
  preview: item.preview,
  isFavorite: item.is_favorite,
  lastUsedAt: item.last_used_at,
});

/**
 * Wires the canned-response library into a TextEditor's `snippets` prop for one ticket. Returns undefined
 * when disabled (client portal, read-only), so the editor shows no picker at all.
 *
 * Merge fields are resolved here, at insert time, so the agent sees the final text before sending.
 * createComment resolves any token left in the stored note with the same resolver.
 */
export function useCannedResponseSnippets(ticketId: string | undefined, enabled: boolean): EditorSnippetsConfig | undefined {
  const { t } = useTranslation('features/tickets');
  // The picker is hidden (no button, slash entries or Mod+J) until the viewer is known to hold canned_response:read.
  const { read: canRead } = useCannedResponsePermissions();
  const bodies = useRef(new Map<string, string>());
  const context = useRef<{ ticketId: string; value: Promise<CannedResponseMergeContext> } | null>(null);

  return useMemo(() => {
    if (!enabled || !canRead || !ticketId) return undefined;
    const remember = (items: CannedResponsePickerItem[]) => {
      items.forEach((item) => bodies.current.set(item.canned_response_id, item.body));
      return items.map(toSnippet);
    };
    const options = { ticketId, surface: 'msp' as const };

    const loadContext = () => {
      if (!context.current || context.current.ticketId !== ticketId) {
        const value = getCannedResponseMergeContext(ticketId).then((result) => unwrapResult(result) as CannedResponseMergeContext);
        // A failed load must not be cached, or every later insert would fail too.
        value.catch(() => {
          context.current = null;
        });
        context.current = { ticketId, value };
      }
      return context.current.value;
    };

    return {
      idPrefix: `canned-response-picker-${ticketId}`,
      labels: {
        button: t('cannedResponses.picker.button', 'Canned responses'),
        buttonTooltip: t('cannedResponses.picker.buttonTooltip', 'Insert a canned response (Ctrl/Cmd+J, or type /)'),
        title: t('cannedResponses.picker.title', 'Insert a canned response'),
        searchPlaceholder: t('cannedResponses.picker.searchPlaceholder', 'Search canned responses…'),
        searchLabel: t('cannedResponses.picker.searchLabel', 'Search canned responses'),
        loading: t('cannedResponses.picker.loading', 'Loading canned responses…'),
        empty: t('cannedResponses.picker.empty', 'No canned responses are available yet.'),
        noResults: t('cannedResponses.picker.noResults', 'No canned responses match your search.'),
        loadFailed: t('cannedResponses.picker.loadFailed', 'Canned responses could not be loaded.'),
        insertFailed: t('cannedResponses.picker.insertFailed', 'The canned response could not be inserted.'),
        favorites: t('cannedResponses.picker.favorites', 'Favorites'),
        recent: t('cannedResponses.picker.recent', 'Recently used'),
        uncategorized: t('cannedResponses.picker.uncategorized', 'Uncategorized'),
        slashGroup: t('cannedResponses.picker.slashGroup', 'Canned responses'),
        slashBrowse: t('cannedResponses.picker.slashBrowse', 'Canned responses…'),
        slashBrowseHint: t('cannedResponses.picker.slashBrowseHint', 'Browse and insert a saved reply'),
      },
      load: async () => remember(unwrapResult(await listVisibleCannedResponses(options)) as CannedResponsePickerItem[]),
      search: async (query: string) =>
        remember(unwrapResult(await searchCannedResponses(query, options)) as CannedResponsePickerItem[]),
      resolve: async (snippet: EditorSnippet): Promise<PartialBlock[]> => {
        const body = bodies.current.get(snippet.id);
        if (!body) throw new Error('Canned response body not loaded');
        const merge = await loadContext();
        return JSON.parse(resolveMergeFieldsInNote(body, merge)) as PartialBlock[];
      },
      onInserted: async (snippet: EditorSnippet) => {
        // Recents are bookkeeping; never let a failure here surface as an insert failure.
        await recordCannedResponseUse(snippet.id).catch(() => undefined);
      },
    };
  }, [enabled, canRead, ticketId, t]);
}
