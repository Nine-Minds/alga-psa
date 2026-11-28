import type { IBoard, IPriority, IStatus, ITag, ProjectWithPhases } from '@alga-psa/types';

/**
 * Registry of the reference lists the shared cache knows about. Adding a picker list means adding
 * a key here (plus its loader in the composition layer), not writing a new hook.
 */
export const REFERENCE_LIST_KEYS = [
  'boards',
  'ticketStatuses',
  'ticketTags',
  'projectTaskTags',
  'projectsWithPhases',
  'priorities:ticket',
  'priorities:project_task',
] as const;

export type ReferenceListKey = (typeof REFERENCE_LIST_KEYS)[number];

/** Value type of each list, as the matching existing server action returns it. */
export interface ReferenceListValues {
  boards: IBoard[];
  ticketStatuses: IStatus[];
  ticketTags: ITag[];
  projectTaskTags: ITag[];
  projectsWithPhases: ProjectWithPhases[];
  'priorities:ticket': IPriority[];
  'priorities:project_task': IPriority[];
}

export const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * How long a loaded list is served without a refetch. `0` means "always revalidate on mount": the
 * cached value still renders at once (stale-while-revalidate), the refetch runs in the background.
 */
export const REFERENCE_LIST_FRESH_FOR_MS: Record<ReferenceListKey, number> = {
  boards: FIVE_MINUTES_MS,
  ticketStatuses: FIVE_MINUTES_MS,
  ticketTags: FIVE_MINUTES_MS,
  projectTaskTags: FIVE_MINUTES_MS,
  projectsWithPhases: 0,
  'priorities:ticket': FIVE_MINUTES_MS,
  'priorities:project_task': FIVE_MINUTES_MS,
};

/** Wire shape for a key whose loader failed. The batch as a whole still succeeds. */
export interface ReferenceListErrorMarker {
  __referenceListError: true;
  message?: string;
}

export function referenceListError(message?: string): ReferenceListErrorMarker {
  return { __referenceListError: true, message };
}

export function isReferenceListError(value: unknown): value is ReferenceListErrorMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __referenceListError?: unknown }).__referenceListError === true
  );
}

/** One batched fetch for the given keys. Keys that failed come back as error markers. */
export type LoadReferenceLists = (
  keys: ReferenceListKey[]
) => Promise<Partial<Record<ReferenceListKey, unknown>>>;

export type ReferenceListEntry =
  | { status: 'ok'; value: unknown; fetchedAt: number; invalidated?: boolean }
  | { status: 'error'; value?: unknown; message?: string; fetchedAt: number; invalidated?: boolean };

export function referenceListCacheKey(scope: string, key: ReferenceListKey): readonly ['ref', string, ReferenceListKey] {
  return ['ref', scope, key];
}

/** The cached tag list that a tag of this entity type belongs to; null for types with no cached list. */
export function tagReferenceListKey(taggedType: string | undefined): 'ticketTags' | 'projectTaskTags' | null {
  if (taggedType === 'ticket') return 'ticketTags';
  if (taggedType === 'project_task') return 'projectTaskTags';
  return null;
}

/** Both tag lists, for tag changes that are not tied to one entity type (rename, recolor by id). */
export const ALL_TAG_LIST_KEYS = ['ticketTags', 'projectTaskTags'] as const satisfies readonly ReferenceListKey[];
