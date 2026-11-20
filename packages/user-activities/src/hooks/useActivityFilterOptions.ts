'use client';

import { useMemo } from 'react';
import {
  ActivityType,
  IPriority,
  IStatus,
  ITag,
  ProjectWithPhases,
} from '@alga-psa/types';
import { useReferenceLists, type ReferenceListKey } from '@alga-psa/ui/lib/referenceData';

type BoardOption = { board_id?: string; board_name?: string };

export interface ActivityFilterOptions {
  priorities: IPriority[];
  projects: ProjectWithPhases[];
  boards: BoardOption[];
  ticketStatuses: IStatus[];
  ticketTags: ITag[];
  projectTaskTags: ITag[];
  /** True while that option list has not loaded yet. A loaded empty list is `false`. */
  loading: Record<Exclude<keyof ActivityFilterOptions, 'loading'>, boolean>;
}

// Stable empties: consumers put these arrays in effect and memo dependencies.
const NO_PRIORITIES: IPriority[] = [];
const NO_PROJECTS: ProjectWithPhases[] = [];
const NO_BOARDS: BoardOption[] = [];
const NO_STATUSES: IStatus[] = [];
const NO_TAGS: ITag[] = [];

const LIST_KEYS: ReferenceListKey[] = ['boards', 'ticketStatuses', 'ticketTags', 'projectTaskTags', 'projectsWithPhases'];

/** Priorities are offered only when a single prioritized activity type is selected. */
function priorityKeyFor(types: ActivityType[] | undefined): ReferenceListKey | null {
  if (types?.length !== 1) return null;
  if (types[0] === ActivityType.TICKET) return 'priorities:ticket';
  if (types[0] === ActivityType.PROJECT_TASK) return 'priorities:project_task';
  return null;
}

/**
 * Option data for `ActivitiesTableFilters`, read from the shared reference-list cache: a warm cache
 * renders on the first pass, a cold one loads every list in one batched server action. This hook
 * never gates the activities fetch (that waits only for the saved filters, #4217).
 */
export function useActivityFilterOptions(types: ActivityType[] | undefined): ActivityFilterOptions {
  const priorityKey = priorityKeyFor(types);
  const keys = useMemo(() => (priorityKey ? [...LIST_KEYS, priorityKey] : LIST_KEYS), [priorityKey]);
  const { data, loading } = useReferenceLists(keys);

  return {
    priorities: (priorityKey ? (data[priorityKey] as IPriority[] | undefined) : undefined) ?? NO_PRIORITIES,
    projects: (data.projectsWithPhases as ProjectWithPhases[] | undefined) ?? NO_PROJECTS,
    boards: (data.boards as BoardOption[] | undefined) ?? NO_BOARDS,
    ticketStatuses: (data.ticketStatuses as IStatus[] | undefined) ?? NO_STATUSES,
    ticketTags: (data.ticketTags as ITag[] | undefined) ?? NO_TAGS,
    projectTaskTags: (data.projectTaskTags as ITag[] | undefined) ?? NO_TAGS,
    loading: {
      priorities: priorityKey ? loading[priorityKey] : false,
      projects: loading.projectsWithPhases,
      boards: loading.boards,
      ticketStatuses: loading.ticketStatuses,
      ticketTags: loading.ticketTags,
      projectTaskTags: loading.projectTaskTags,
    },
  };
}
