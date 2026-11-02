import type { QuerySchema } from '@alga-psa/predicates';
import { tagSet } from '@alga-psa/predicates/sql';

const id = (column: string) => ({ kind: 'column' as const, column, type: 'uuid' as const, operators: ['in', 'not_in'] as const });

/** The persisted requester vocabulary. Every relation is tenant-correlated by the compiler. */
export const audienceSchema: QuerySchema = {
  table: 'contacts',
  attributes: {},
  relations: {
    contact: {
      kind: 'one', table: 'contacts', local: 'contact_name_id', foreign: 'contact_name_id',
      attributes: { id: id('contact_name_id'), tags: tagSet({ taggedType: 'contact', local: 'contact_name_id' }) },
      relations: {
        group: {
          kind: 'one', table: 'client_portal_visibility_groups', local: 'portal_visibility_group_id', foreign: 'group_id',
          correlate: [{ local: 'client_id', foreign: 'client_id' }],
          attributes: { id: id('group_id') },
        },
      },
    },
    client: {
      kind: 'one', table: 'clients', local: 'client_id', foreign: 'client_id',
      attributes: { id: id('client_id'), tags: tagSet({ taggedType: 'client', local: 'client_id' }) },
    },
    user: {
      kind: 'many', table: 'users', local: 'contact_name_id', foreign: 'contact_id', where: { user_type: 'client' },
      attributes: { id: id('user_id') },
    },
  },
};
