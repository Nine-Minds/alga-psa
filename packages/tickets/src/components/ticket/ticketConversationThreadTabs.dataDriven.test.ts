import { describe, expect, it } from 'vitest';
import type { IComment } from '@alga-psa/types';
import { buildCommentThreadGroups, type CommentThreadGroup } from '@alga-psa/ui/components';
import {
  buildThreadTabs,
  buildTicketThreadTabState,
  NATIVE_THREAD_TABS,
  type TicketThreadTabDefinition,
} from './ticketConversationThreadTabs';

function comment(overrides: Partial<IComment> & Pick<IComment, 'comment_id'>): IComment {
  return {
    tenant: 'tenant-1', author_type: 'internal', user_id: 'user-1', note: '[]',
    created_at: '2026-05-13T09:00:00.000Z', ...overrides,
  };
}

function groupsOf(comments: IComment[]): CommentThreadGroup<IComment>[] {
  return buildCommentThreadGroups<IComment>({
    comments,
    getCommentId: (item) => item.comment_id,
    getThreadId: (item) => item.thread_id || item.comment_id,
    getParentCommentId: (item) => item.parent_comment_id,
    getCreatedAt: (item) => item.created_at,
  });
}

// Mixes public, internal and resolution threads, including a resolution reply under an internal root.
const FIXTURE = groupsOf([
  comment({ comment_id: 'p1', thread_id: 'tp1', is_internal: false }),
  comment({ comment_id: 'p1r', thread_id: 'tp1', parent_comment_id: 'p1', is_internal: false, created_at: '2026-05-13T09:05:00.000Z' }),
  comment({ comment_id: 'i1', thread_id: 'ti1', is_internal: true, created_at: '2026-05-13T09:10:00.000Z' }),
  comment({ comment_id: 'i1r', thread_id: 'ti1', parent_comment_id: 'i1', is_internal: true, is_resolution: true, created_at: '2026-05-13T09:15:00.000Z' }),
  comment({ comment_id: 'r1', thread_id: 'tr1', is_internal: false, is_resolution: true, created_at: '2026-05-13T09:20:00.000Z' }),
  comment({ comment_id: 'i2', thread_id: 'ti2', is_internal: true, created_at: '2026-05-13T09:25:00.000Z' }),
]);

const ids = (comments: IComment[]) => comments.map((c) => c.comment_id);

describe('data-driven thread tabs', () => {
  it('keeps the native four tabs, ids and order', () => {
    expect(NATIVE_THREAD_TABS.map((t) => t.id)).toEqual(['all-comments', 'client', 'internal', 'resolution']);
    expect(NATIVE_THREAD_TABS.filter((t) => t.portal).map((t) => t.id)).toEqual(['all-comments', 'resolution']);
  });

  it('MSP fixture: values frozen from the pre-refactor implementation', () => {
    const state = buildTicketThreadTabState(FIXTURE, false);
    expect(ids(state.allTabComments)).toEqual(['p1', 'p1r', 'i1', 'i1r', 'r1', 'i2']);
    expect(ids(state.clientTabComments)).toEqual(['p1', 'p1r', 'r1']);
    expect(ids(state.internalTabComments)).toEqual(['i1', 'i1r', 'i2']);
    expect(ids(state.resolutionTabComments)).toEqual(['i1', 'i1r', 'r1']);
    expect(state.counts).toEqual({ all: 4, client: 2, internal: 2, resolution: 2 });
  });

  it('portal fixture: All excludes internal threads, Resolution drops internal resolutions, only the portal tabs build', () => {
    const state = buildTicketThreadTabState(FIXTURE, true);
    expect(ids(state.allTabComments)).toEqual(['p1', 'p1r', 'r1']);
    expect(ids(state.resolutionTabComments)).toEqual(['r1']);
    expect(state.counts).toEqual({ all: 2, client: 2, internal: 2, resolution: 1 });

    const tabs = buildThreadTabs(FIXTURE, NATIVE_THREAD_TABS, { hideInternal: true });
    expect(tabs.map((t) => t.id)).toEqual(['all-comments', 'resolution']);
    expect(ids(tabs[0].comments)).toEqual(ids(state.allTabComments));
    expect(tabs.map((t) => t.count)).toEqual([2, 1]);
  });

  it('builds a supplied tab list: a custom tab, its count and portal visibility', () => {
    const mine: TicketThreadTabDefinition = {
      id: 'mine', containerId: 'mine-comments', labelKey: 'x.mine', labelDefault: 'Mine',
      includes: (group) => group.root.comment_id === 'i2', portal: false,
    };
    const shown = buildThreadTabs(FIXTURE, [NATIVE_THREAD_TABS[0], mine], { hideInternal: false });
    expect(shown.map((t) => [t.id, t.count])).toEqual([['all-comments', 4], ['mine', 1]]);
    expect(ids(shown[1].comments)).toEqual(['i2']);
    expect(buildThreadTabs(FIXTURE, [NATIVE_THREAD_TABS[0], mine], { hideInternal: true }).map((t) => t.id)).toEqual(['all-comments']);
  });
});
