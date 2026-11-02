import type { Knex } from 'knex';

/** The slice of a `tenantDb(trx, tenant)` handle this rule needs. */
interface ContactEmailMatchDb {
  subquery(table: string): Knex.QueryBuilder;
}

/**
 * The one rule for "this address belongs to this contact": the contact's primary email OR one of its
 * additional addresses. Pass the result to `.andWhere(...)` on a `contacts` query built from `db`.
 * `normalizedEmail` must come from `normalizeEmailAddress`.
 */
export function contactEmailMatch(db: ContactEmailMatchDb, trx: Knex.Transaction, normalizedEmail: string) {
  return function contactEmailMatch(this: Knex.QueryBuilder) {
    this
      .where('contacts.email', normalizedEmail)
      .orWhereExists(
        db.subquery('contact_additional_email_addresses as caea')
          .select(trx.raw('1'))
          .whereRaw('caea.contact_name_id = contacts.contact_name_id')
          .andWhere('caea.normalized_email_address', normalizedEmail)
      );
  };
}
