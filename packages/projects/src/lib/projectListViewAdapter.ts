import type { ListViewAdapter, ListViewSort } from '@alga-psa/types';
import {
  createTableListViewAdapter,
  pickFilters,
  type ProjectListViewFilters,
  type TableListLiveState,
} from '@alga-psa/list-views';

/**
 * Named views for the Projects list.
 *
 * The list's filters already live in one typed object (mirrored to the URL);
 * a view stores those minus search text and pagination, plus the table's
 * client-side sort, column widths and page size.
 */

export type ProjectListLiveState = TableListLiveState<ProjectListViewFilters>;

const PROJECT_VIEW_FILTER_KEYS: readonly (keyof ProjectListViewFilters)[] = [
  'status',
  'projectStatus',
  'clientId',
  'contactId',
  'managerId',
  'tags',
  'deadlineType',
  'deadlineDate',
  'deadlineEndDate',
];

/** Only the keys a view stores, whatever else the live filter object carries. */
export function pickProjectViewFilters(filters: object): ProjectListViewFilters {
  return pickFilters<ProjectListViewFilters>(filters, PROJECT_VIEW_FILTER_KEYS);
}

export function createProjectListViewAdapter(context: {
  defaultFilters: ProjectListViewFilters;
  defaultSort: ListViewSort;
  defaultPageSize: number;
  known: { clientIds?: ReadonlySet<string> };
}): ListViewAdapter<ProjectListLiveState, ProjectListViewFilters> {
  return createTableListViewAdapter<ProjectListViewFilters>({
    listKey: 'projects',
    filterKeys: PROJECT_VIEW_FILTER_KEYS,
    defaults: {
      filters: context.defaultFilters,
      sort: context.defaultSort,
      pageSize: context.defaultPageSize,
    },
    // Contacts and managers load lazily and project statuses come from the
    // loaded projects, so only clients can be checked; the others are kept.
    sanitizeFilters: (filters, collector) => ({
      ...filters,
      clientId: collector.keepScalar('clientId', filters.clientId, context.known.clientIds),
    }),
  });
}

/** The client ids that saved views reference in their filters (distinct). */
export function collectViewClientIds(
  views: ReadonlyArray<{ settings: { filters?: { clientId?: string } | null } }>,
): string[] {
  const ids = new Set<string>();
  for (const view of views) {
    const clientId = view.settings.filters?.clientId;
    if (clientId) ids.add(clientId);
  }
  return Array.from(ids);
}

/**
 * Checks only the referenced client ids (never the whole client table) and returns the
 * set that `known.clientIds` should hold. A referenced client that no longer exists is
 * absent, so the adapter drops that filter. If the lookup itself fails, every
 * referenced id is kept: an unverifiable reference is not evidence of deletion.
 */
export async function resolveKnownClientIds(
  referencedIds: readonly string[],
  getExistingClientIds: (clientIds: string[]) => Promise<string[]>,
): Promise<Set<string>> {
  if (referencedIds.length === 0) return new Set();
  try {
    return new Set(await getExistingClientIds([...referencedIds]));
  } catch (error) {
    console.error('[projects] failed to verify saved-view clients', error);
    return new Set(referencedIds);
  }
}
