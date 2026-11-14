import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

// A user's client portfolio: the clients they are responsible for, one row per
// (user, client) in `user_client_portfolios`. The kernel's `client_portfolio`
// template evaluates it as `subject.portfolioClientIds`. A user with no rows has
// no portfolio, and the template denies.

const PORTFOLIO_TABLE = 'user_client_portfolios';

export interface UserClientPortfolioTarget {
  tenant: string;
  userId: string;
}

export interface SetUserClientPortfolioInput extends UserClientPortfolioTarget {
  clientIds: readonly string[];
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0))).sort();
}

/**
 * The client ids in a user's portfolio, sorted. Empty when the user has none.
 */
export async function readUserClientPortfolio(
  knex: Knex | Knex.Transaction,
  input: UserClientPortfolioTarget
): Promise<string[]> {
  const rows = await tenantDb(knex, input.tenant)
    .table(PORTFOLIO_TABLE)
    .where({ user_id: input.userId })
    .orderBy('client_id', 'asc')
    .select<{ client_id: string }[]>('client_id');

  return rows.map((row) => row.client_id);
}

/**
 * Replace a user's portfolio with exactly `clientIds`, atomically: a concurrent
 * reader sees the old set or the new one, never a mixture. An empty list leaves
 * the user with no portfolio. Returns the stored set.
 */
export async function setUserClientPortfolio(
  knex: Knex | Knex.Transaction,
  input: SetUserClientPortfolioInput
): Promise<string[]> {
  const desired = uniqueSorted(input.clientIds);

  return knex.transaction(async (trx) => {
    const scopedDb = tenantDb(trx, input.tenant);

    // The user row is the lock: two concurrent replacements of one portfolio
    // serialize here instead of interleaving their deletes and inserts.
    const user = await scopedDb.table('users')
      .where({ user_id: input.userId })
      .forUpdate()
      .first<{ user_id: string }>('user_id');
    if (!user) {
      throw new Error('Client portfolio user was not found in tenant scope.');
    }

    if (desired.length > 0) {
      const found = await scopedDb.table('clients')
        .whereIn('client_id', desired)
        .select<{ client_id: string }[]>('client_id');
      if (found.length !== desired.length) {
        throw new Error('Client portfolio client was not found in tenant scope.');
      }
    }

    const current = await scopedDb.table(PORTFOLIO_TABLE)
      .where({ user_id: input.userId })
      .select<{ client_id: string }[]>('client_id');
    const currentIds = new Set(current.map((row) => row.client_id));
    const desiredIds = new Set(desired);

    const removed = [...currentIds].filter((clientId) => !desiredIds.has(clientId));
    const added = desired.filter((clientId) => !currentIds.has(clientId));

    if (removed.length > 0) {
      await scopedDb.table(PORTFOLIO_TABLE)
        .where({ user_id: input.userId })
        .whereIn('client_id', removed)
        .del();
    }
    if (added.length > 0) {
      await scopedDb.table(PORTFOLIO_TABLE).insert(
        added.map((clientId) => ({
          tenant: input.tenant,
          user_id: input.userId,
          client_id: clientId,
        }))
      );
    }

    return desired;
  });
}

/**
 * Remove every client from a user's portfolio.
 */
export async function clearUserClientPortfolio(
  knex: Knex | Knex.Transaction,
  input: UserClientPortfolioTarget
): Promise<void> {
  await tenantDb(knex, input.tenant)
    .table(PORTFOLIO_TABLE)
    .where({ user_id: input.userId })
    .del();
}
