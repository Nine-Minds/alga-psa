import type { Knex } from 'knex';

/**
 * The two SLA hooks the tickets package depends on without depending on `@alga-psa/sla`:
 * configuring the ITIL SLA policy for a new ITIL board, and cancelling a ticket's SLA timer.
 *
 * They are held on `globalThis`, the way `ticketListViews` and `ticketResponsibility` hold their
 * providers, because Next builds separate module instances for startup code and for server
 * actions: a hook registered at startup in one instance is invisible to a plain module variable in
 * the other, which is why creating an ITIL board from the settings screen used to depend on an MSP
 * page having rendered first (F122 of `ee/plans/2026-11-21-itil-remediation`).
 */

export type ConfigureItilSlaForBoard = (
  trx: Knex.Transaction,
  tenant: string,
  boardId: string
) => Promise<{ created: boolean }>;

export type CancelTicketSla = (tenantId: string, ticketId: string) => Promise<void>;

interface SlaIntegrationHooks {
  configureItilSlaForBoard: ConfigureItilSlaForBoard | null;
  cancelSla: CancelTicketSla | null;
}

const STORE_KEY = Symbol.for('alga.tickets.slaIntegrationHooks');

function hooks(): SlaIntegrationHooks {
  const host = globalThis as unknown as Record<symbol, SlaIntegrationHooks | undefined>;
  return (host[STORE_KEY] ??= { configureItilSlaForBoard: null, cancelSla: null });
}

export function registerItilSlaConfigurationHook(fn: ConfigureItilSlaForBoard): void {
  hooks().configureItilSlaForBoard = fn;
}

export function getItilSlaConfigurationHook(): ConfigureItilSlaForBoard | null {
  return hooks().configureItilSlaForBoard;
}

export function registerSlaCancellationHook(fn: CancelTicketSla): void {
  hooks().cancelSla = fn;
}

export function getSlaCancellationHook(): CancelTicketSla | null {
  return hooks().cancelSla;
}

export function areSlaIntegrationHooksRegistered(): boolean {
  const current = hooks();
  return current.configureItilSlaForBoard !== null && current.cancelSla !== null;
}

/**
 * Startup guard, in the shape `initializeApp` already uses for its notifier registrations: log
 * loudly, do not throw. A runtime without these hooks still serves tickets; what it cannot do is
 * give a new ITIL board its SLA policy or stop a closed ticket's timer, and that should be visible
 * at boot rather than at the first board create.
 */
export function assertSlaIntegrationRegistered(entrypoint: string): boolean {
  if (areSlaIntegrationHooksRegistered()) {
    return true;
  }
  console.error('[SlaIntegration] NO SLA integration registered; ITIL boards would get no SLA policy and closed tickets would keep their timers', {
    event: 'sla_integration_hooks_missing',
    entrypoint,
    remediation: 'Call registerSlaIntegration() at startup of every runtime that serves ticket actions.',
  });
  return false;
}

/** Test seam: forget both hooks. Never called by product code. */
export function clearSlaIntegrationHooksForTest(): void {
  const current = hooks();
  current.configureItilSlaForBoard = null;
  current.cancelSla = null;
}
