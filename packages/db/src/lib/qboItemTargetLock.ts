import type { Knex } from 'knex';

/**
 * Transaction-scoped advisory lock on one QuickBooks Online item target
 * (tenant + realm + external item id).
 *
 * Several services may now map to one QBO item, so anything that reasons about
 * the SET of mappings on an item must serialize with every writer of that set:
 * mapping create / relink / target edit / unlink (integrations) and item import
 * apply (billing). Row locks cannot do this — they cannot stop a new mapping
 * insert. The unique indexes still enforce exclusive targets; this lock only
 * keeps a decision (import's "this item has exactly one service") from being
 * made on a stale set.
 *
 * Lives in @alga-psa/db because the vertical packages may not import each other.
 *
 * Callers locking several targets (a target edit touches old and new) must use
 * lockQboItemTargets so acquisition order is stable and cannot deadlock.
 */
export function qboItemTargetLockKey(tenant: string, realm: string | null | undefined, itemId: string): string {
  return `qbo-item-target:${tenant}:${realm ?? ''}:${itemId}`;
}

export async function lockQboItemTarget(
  trx: Knex.Transaction,
  tenant: string,
  realm: string | null | undefined,
  itemId: string
): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [
    qboItemTargetLockKey(tenant, realm, itemId),
  ]);
}

export async function lockQboItemTargets(
  trx: Knex.Transaction,
  tenant: string,
  targets: ReadonlyArray<{ realm: string | null | undefined; itemId: string | null | undefined }>
): Promise<void> {
  const keys = [
    ...new Set(
      targets.filter((t) => t.itemId).map((t) => qboItemTargetLockKey(tenant, t.realm, t.itemId as string))
    ),
  ].sort();
  for (const key of keys) {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [key]);
  }
}
