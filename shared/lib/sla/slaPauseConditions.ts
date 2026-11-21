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

/**
 * Re-evaluates a ticket's SLA pause state inside the caller's transaction, and tells the timer
 * backend after that transaction commits. Throws when the pause state could not be written.
 */
export type SlaPauseReevaluator = (
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  actorUserId?: string,
) => Promise<void>;

const REEVALUATOR_KEY = '__algaSlaPauseReevaluator';

/**
 * The SLA package registers the re-evaluator (importing `@alga-psa/sla/services` does it). A
 * contributor whose condition just changed calls `reevaluateSlaPause` instead of importing the SLA
 * package, which already depends on notifications and so on the contributor's own package: a
 * direct import would close a build cycle.
 */
export function registerSlaPauseReevaluator(reevaluator: SlaPauseReevaluator): void {
  (globalThis as Record<string, unknown>)[REEVALUATOR_KEY] = reevaluator;
}

/**
 * Re-evaluates the ticket's pause state after a contributed condition changed. With no
 * re-evaluator registered it throws, so a caller that commits its state change together with the
 * clock fact rolls back rather than leaving the clock silently out of step.
 */
export async function reevaluateSlaPause(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  actorUserId?: string,
): Promise<void> {
  const reevaluator = (globalThis as Record<string, unknown>)[REEVALUATOR_KEY] as SlaPauseReevaluator | undefined;
  if (!reevaluator) throw new Error('SLA pause re-evaluation is not registered: import @alga-psa/sla/services at startup');
  await reevaluator(trx, tenant, ticketId, actorUserId);
}

/** Test-only. Clears contributors and the re-evaluator. */
export function resetSlaPauseConditionsForTests(): void {
  contributors().clear();
  delete (globalThis as Record<string, unknown>)[REEVALUATOR_KEY];
}
