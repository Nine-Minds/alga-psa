import type { Knex } from 'knex';

/**
 * Extra reasons a ticket's SLA clock stays paused, contributed by a package that owns a state the
 * SLA package does not know about (today: a ticket with client IT under a co-managed seat
 * arrangement).
 *
 * SLA pause was a closed set of conditions (awaiting client, a pausing status), each re-derived
 * from ticket state whenever any writer re-evaluates the pause. A pause that only one event set
 * would be undone by the next unrelated status or response-state change. A contributor is
 * consulted by every re-evaluation, so the state that pauses the clock also keeps it paused.
 *
 * Neutrality: with no contributor registered, `activeSlaPauseCondition` resolves to null without
 * touching `trx`. A contributor returns null without querying when the tenant is not one it serves.
 *
 * The registry is process-global (as the ticket lifecycle registry is), so every copy of this
 * module in a process sees the same contributors.
 */
export type SlaPauseConditionReason = 'client_it_responsibility';

export type SlaPauseConditionContributor = (
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string,
) => Promise<SlaPauseConditionReason | null>;

// LEVERAGE: pattern global-keyed-registry — a Map or array on globalThis shared by split bundles, with register/resolve/reset; also ticketLifecycleHooks, ticketListViews, ticketResponsibility and seatTicketWork's observers
const KEY = '__algaSlaPauseConditionContributors';

function contributors(): Map<string, SlaPauseConditionContributor> {
  const g = globalThis as Record<string, unknown>;
  return (g[KEY] ??= new Map<string, SlaPauseConditionContributor>()) as Map<string, SlaPauseConditionContributor>;
}

/** Idempotent per id: registering again replaces the earlier contributor. */
export function registerSlaPauseCondition(id: string, contributor: SlaPauseConditionContributor): void {
  contributors().set(id, contributor);
}

/** The first registered condition that holds for the ticket, or null. */
export async function activeSlaPauseCondition(
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string,
): Promise<SlaPauseConditionReason | null> {
  const registered = contributors();
  if (registered.size === 0) return null;
  for (const contributor of [...registered.values()]) {
    const reason = await contributor(trx, tenant, ticketId);
    if (reason) return reason;
  }
  return null;
}

/** Test-only. */
export function resetSlaPauseConditionsForTests(): void {
  contributors().clear();
}
