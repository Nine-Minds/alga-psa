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
