import type { ListViewAdapter, ListViewSort } from '@alga-psa/types';
import {
  createTableListViewAdapter,
  type ClientListViewFilters,
  type ContactListViewFilters,
  type TableListLiveState,
} from '@alga-psa/list-views';

/**
 * Named views for the Clients and Contacts lists. Both keep their filters in
 * separate pieces of component state; the screens assemble them into these
 * typed live states for capture and spread them back out on apply.
 */

export type ClientListLiveState = TableListLiveState<ClientListViewFilters>;
export type ContactListLiveState = TableListLiveState<ContactListViewFilters>;

export const DEFAULT_CLIENT_LIST_FILTERS: ClientListViewFilters = {
  status: 'active',
  clientType: 'all',
  lifecycle: 'active',
};
export const DEFAULT_CLIENT_LIST_SORT: ListViewSort = { by: 'client_name', direction: 'asc' };

export const DEFAULT_CONTACT_LIST_FILTERS: ContactListViewFilters = { status: 'active' };
export const DEFAULT_CONTACT_LIST_SORT: ListViewSort = { by: 'full_name', direction: 'asc' };

/** `knownTags` undefined while tags are still loading: nothing is dropped. */
export function createClientListViewAdapter(context: {
  defaultPageSize: number;
  knownTags?: ReadonlySet<string>;
}): ListViewAdapter<ClientListLiveState, ClientListViewFilters> {
  return createTableListViewAdapter<ClientListViewFilters>({
    listKey: 'clients',
    filterKeys: ['status', 'clientType', 'lifecycle', 'tags'],
    defaults: {
      filters: DEFAULT_CLIENT_LIST_FILTERS,
      sort: DEFAULT_CLIENT_LIST_SORT,
      pageSize: context.defaultPageSize,
    },
    sanitizeFilters: (filters, collector) => ({
      ...filters,
      tags: collector.keepList('tags', filters.tags, context.knownTags),
    }),
  });
}

export function createContactListViewAdapter(context: {
  defaultPageSize: number;
  knownTags?: ReadonlySet<string>;
}): ListViewAdapter<ContactListLiveState, ContactListViewFilters> {
  return createTableListViewAdapter<ContactListViewFilters>({
    listKey: 'contacts',
    filterKeys: ['status', 'tags'],
    defaults: {
      filters: DEFAULT_CONTACT_LIST_FILTERS,
      sort: DEFAULT_CONTACT_LIST_SORT,
      pageSize: context.defaultPageSize,
    },
    sanitizeFilters: (filters, collector) => ({
      ...filters,
      tags: collector.keepList('tags', filters.tags, context.knownTags),
    }),
  });
}
