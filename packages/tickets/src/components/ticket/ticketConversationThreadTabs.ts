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

export function buildTicketThreadTabState(
  threadGroups: CommentThreadGroup<IComment>[],
  hideInternalTab: boolean
): TicketThreadTabState {
  const visibleGroups = hideInternalTab
    ? threadGroups.filter((group) => !group.root.is_internal)
    : threadGroups;
  const clientGroups = threadGroups.filter((group) => !group.root.is_internal);
  const internalGroups = threadGroups.filter((group) => Boolean(group.root.is_internal));
  const resolutionGroups = threadGroups.filter((group) =>
    (!hideInternalTab || !group.root.is_internal) &&
    group.comments.some((comment) => Boolean(comment.is_resolution))
  );

  return {
    allTabComments: visibleGroups.flatMap((group) => group.comments),
    clientTabComments: clientGroups.flatMap((group) => group.comments),
    internalTabComments: internalGroups.flatMap((group) => group.comments),
    resolutionTabComments: resolutionGroups.flatMap((group) => group.comments),
    counts: {
      all: visibleGroups.length,
      client: clientGroups.length,
      internal: internalGroups.length,
      resolution: resolutionGroups.length,
    },
  };
}
