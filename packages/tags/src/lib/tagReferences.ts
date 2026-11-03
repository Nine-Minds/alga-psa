import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Tag references: a durable record that some configuration points at a tag definition.
 *
 * Any referrer (display rules, service-request audiences, ...) calls these inside its own write
 * transaction. Orphan cleanup and the tag option loaders read `tag_references` only, so this package
 * never needs to know which referrer types exist: `referrerType` is an opaque string chosen by the
 * caller, `referrerId` identifies the referring row (its own primary key).
 */

const TABLE = 'tag_references';

function requireTransaction(trx: Knex.Transaction): void {
  if (!trx || (trx as { isTransaction?: boolean }).isTransaction !== true) {
    throw new Error('tag references must be written inside the referrer\'s transaction');
  }
}

function requireReferrer(tenant: string, referrerType: string, referrerId: string): void {
  if (!tenant) throw new Error('tenant is required for tag references');
  if (!referrerType || !referrerType.trim()) throw new Error('referrerType is required for tag references');
  if (!referrerId) throw new Error('referrerId is required for tag references');
}

/**
 * Makes `tagIds` exactly the set of tag definitions that referrer points at: deletes the referrer's
 * existing rows and inserts the deduplicated set. Idempotent. A tag id that is not a definition of
 * `tenant` is rejected by the (tenant, tag_id) foreign key.
 */
export async function replaceTagReferences(
  trx: Knex.Transaction,
  tenant: string,
  referrerType: string,
  referrerId: string,
  tagIds: readonly string[],
): Promise<void> {
  requireTransaction(trx);
  requireReferrer(tenant, referrerType, referrerId);

  const db = tenantDb(trx, tenant);
  await db.table(TABLE).where({ referrer_type: referrerType, referrer_id: referrerId }).del();

  const unique = Array.from(new Set(tagIds));
  if (unique.length === 0) return;
  await db.table(TABLE).insert(
    unique.map((tag_id) => ({ tenant, tag_id, referrer_type: referrerType, referrer_id: referrerId })),
  );
}

/** Removes every reference held by one referrer (call when the referrer is deleted). */
export async function deleteTagReferences(
  trx: Knex.Transaction,
  tenant: string,
  referrerType: string,
  referrerId: string,
): Promise<void> {
  requireTransaction(trx);
  requireReferrer(tenant, referrerType, referrerId);

  await tenantDb(trx, tenant)
    .table(TABLE)
    .where({ referrer_type: referrerType, referrer_id: referrerId })
    .del();
}
