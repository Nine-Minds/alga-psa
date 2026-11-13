import type { IComment } from '@alga-psa/types';
import type { CommentThreadGroup } from '@alga-psa/ui/components';

export interface TicketThreadTabState {
  allTabComments: IComment[];
  clientTabComments: IComment[];
  internalTabComments: IComment[];
  resolutionTabComments: IComment[];
  counts: {
    all: number;
    client: number;
    internal: number;
    resolution: number;
  };
}

/** What a tab's predicate may depend on. `hideInternal` is the client portal. */
export interface ThreadTabContext {
  hideInternal: boolean;
}

export interface TicketThreadTabDefinition {
  /** Tab id (also the Tabs value). */
  id: string;
  /** `ReflectionContainer` id suffix: the container id is `${componentId}-${containerId}`. */
  containerId: string;
  /** Tab label; the rendered label is `Label (count)`. */
  labelKey: string;
  labelDefault: string;
  /** `ReflectionContainer` label; defaults to the tab label. */
  containerLabelKey?: string;
  containerLabelDefault?: string;
  /** Renders an `<h3>` with the container label above the comments. */
  heading?: boolean;
  /** Which threads this tab holds. Counts are thread counts. */
  includes: (group: CommentThreadGroup<IComment>, ctx: ThreadTabContext) => boolean;
  /** Shown to the client portal as well as the MSP app. */
  portal: boolean;
  /** Names a block the host renders after the comments (the native Client tab's external comments). */
  trailing?: string;
}

/** The four tabs the ticket screen has always had, in order. */
export const NATIVE_THREAD_TABS: readonly TicketThreadTabDefinition[] = [
  {
    id: 'all-comments',
    containerId: 'all-comments',
    labelKey: 'conversation.allComments',
    labelDefault: 'All Comments',
    // The portal's "All Comments" excludes internal threads; the MSP app's includes everything.
    includes: (group, ctx) => !ctx.hideInternal || !group.root.is_internal,
    portal: true,
  },
  {
    id: 'client',
    containerId: 'client-visible-comments',
    labelKey: 'conversation.client',
    labelDefault: 'Client',
    containerLabelKey: 'conversation.clientComments',
    containerLabelDefault: 'Client Comments',
    includes: (group) => !group.root.is_internal,
    portal: false,
    trailing: 'external-comments',
  },
  {
    id: 'internal',
    containerId: 'internal-comments',
    labelKey: 'conversation.internal',
    labelDefault: 'Internal',
    containerLabelKey: 'conversation.internalComments',
    containerLabelDefault: 'Internal Comments',
    heading: true,
    includes: (group) => Boolean(group.root.is_internal),
    portal: false,
  },
  {
    id: 'resolution',
    containerId: 'resolution-comments',
    labelKey: 'conversation.resolution',
    labelDefault: 'Resolution',
    containerLabelKey: 'conversation.resolutionComments',
    containerLabelDefault: 'Resolution Comments',
    heading: true,
    includes: (group, ctx) =>
      (!ctx.hideInternal || !group.root.is_internal) &&
      group.comments.some((comment) => Boolean(comment.is_resolution)),
    portal: true,
  },
];

export interface BuiltThreadTab {
  id: string;
  comments: IComment[];
  /** Thread count. */
  count: number;
}

function evaluateTab(
  threadGroups: CommentThreadGroup<IComment>[],
  tab: TicketThreadTabDefinition,
  ctx: ThreadTabContext,
): BuiltThreadTab {
  const groups = threadGroups.filter((group) => tab.includes(group, ctx));
  return { id: tab.id, comments: groups.flatMap((group) => group.comments), count: groups.length };
}

/** The tabs `ctx` shows (the portal sees only `portal` tabs), each with its threads' comments and count. */
export function buildThreadTabs(
  threadGroups: CommentThreadGroup<IComment>[],
  tabs: readonly TicketThreadTabDefinition[],
  ctx: ThreadTabContext,
): BuiltThreadTab[] {
  return tabs
    .filter((tab) => !ctx.hideInternal || tab.portal)
    .map((tab) => evaluateTab(threadGroups, tab, ctx));
}

/** The native four-bucket view over {@link NATIVE_THREAD_TABS}. Same signature and output as before the tabs became data. */
export function buildTicketThreadTabState(
  threadGroups: CommentThreadGroup<IComment>[],
  hideInternalTab: boolean
): TicketThreadTabState {
  const ctx = { hideInternal: hideInternalTab };
  const bucket = (id: string) => {
    const tab = NATIVE_THREAD_TABS.find((candidate) => candidate.id === id)!;
    return evaluateTab(threadGroups, tab, ctx);
  };
  const all = bucket('all-comments');
  const client = bucket('client');
  const internal = bucket('internal');
  const resolution = bucket('resolution');
  return {
    allTabComments: all.comments,
    clientTabComments: client.comments,
    internalTabComments: internal.comments,
    resolutionTabComments: resolution.comments,
    counts: { all: all.count, client: client.count, internal: internal.count, resolution: resolution.count },
  };
}
