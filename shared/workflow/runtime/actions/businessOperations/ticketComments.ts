import type { Knex } from 'knex';

/**
 * Who counts as the customer on a ticket comment: author_type 'client', which covers both
 * client-portal users and contacts (for example an inbound email reply). The comment_author_type
 * enum is {internal, client, unknown}; migration 20250217202724_update_comment_columns renamed
 * 'contact' to 'client', and querying 'contact' makes Postgres reject the statement. Client-portal
 * replies are authored by a user (user_type 'client'), so user_id alone can't tell a customer reply
 * from an agent reply; author_type can.
 */
export const CUSTOMER_COMMENT_AUTHOR_TYPES = ['client'] as const;

/** Newest comment first; comment_id breaks ties between comments written in the same instant. */
export const orderTicketCommentsNewestFirst = (query: Knex.QueryBuilder): Knex.QueryBuilder =>
  query.orderBy('created_at', 'desc').orderBy('comment_id', 'desc');

/** Only comments the customer wrote: public, by a client-portal user or a contact. */
export const whereCustomerAuthoredComment = (query: Knex.QueryBuilder): Knex.QueryBuilder =>
  query.where('is_internal', false).whereIn('author_type', [...CUSTOMER_COMMENT_AUTHOR_TYPES]);
