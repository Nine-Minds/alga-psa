import type { Knex } from 'knex';

/**
 * Who counts as the customer on a ticket comment: a client-portal user or a contact (for example an
 * inbound email reply); see packages/tickets/src/lib/responseSource.ts. Client-portal replies are
 * authored by a user (user_type 'client'), so user_id alone can't tell a customer reply from an
 * agent reply; author_type can.
 */
export const CUSTOMER_COMMENT_AUTHOR_TYPES = ['client', 'contact'] as const;

/** Newest comment first; comment_id breaks ties between comments written in the same instant. */
export const orderTicketCommentsNewestFirst = (query: Knex.QueryBuilder): Knex.QueryBuilder =>
  query.orderBy('created_at', 'desc').orderBy('comment_id', 'desc');

/** Only comments the customer wrote: public, by a client-portal user or a contact. */
export const whereCustomerAuthoredComment = (query: Knex.QueryBuilder): Knex.QueryBuilder =>
  query.where('is_internal', false).whereIn('author_type', [...CUSTOMER_COMMENT_AUTHOR_TYPES]);
