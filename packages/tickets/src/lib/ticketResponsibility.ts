/**
 * Who is responsible for a ticket, contributed by the package that owns the state (co-managed seat
 * arrangements): the MSP ticket list's responsibility column and filter, and the native ticket
 * screen's responsibility chip and Hand to client IT action.
 *
 * Neither surface knows what responsibility is or who is offered it. A provider says whether a
 * reader is offered it at all, reads the value for a page of tickets or for one ticket, and runs the
 * handoff. With no provider registered, or a provider that does not offer the reader, the list and
 * the ticket screen are exactly what they were: no extra statement, no extra field.
 *
 * Providers are held on globalThis so duplicated module instances (split Next bundles) share one registry.
 */
import type { Knex } from 'knex';
import type { AuthorizationSubject } from '@alga-psa/authorization/kernel/contracts';

export type TicketResponsibility = 'client_it' | 'msp';

export interface TicketResponsibilityInput {
  tenant: string;
  subject: Pick<AuthorizationSubject, 'resolverFacts'>;
}

/** One ticket's responsibility as the ticket screen shows it. */
export interface TicketResponsibilityState {
  responsibility: TicketResponsibility;
  /** What the next handoff must name. */
  revision: number;
  /** Who a ticket may be handed to by name: the arrangement's active seat technicians. */
  technicians: Array<{ user_id: string; display_name: string }>;
}

export interface TicketHandToClientItInput {
  tenant: string;
  ticketId: string;
  actorUserId: string;
  operationId: string;
  expectedRevision: number;
  note: string;
  technicianUserId?: string | null;
}

/** Why a handoff was refused: the provider's stable code, which the caller maps to a translated message. */
export class TicketResponsibilityError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'TicketResponsibilityError';
  }
}

export interface TicketResponsibilityProvider {
  /** Whether the reader is offered the responsibility column and filter. */
  offered(input: TicketResponsibilityInput): Promise<boolean> | boolean;
  /** The responsibility of each ticket that has one; a ticket absent from the map has none. */
  read(trx: Knex.Transaction, tenant: string, ticketIds: readonly string[]): Promise<Map<string, TicketResponsibility>>;
  /** One ticket's state for the ticket screen; null when the ticket has no responsibility (its client has no live arrangement). */
  load(trx: Knex.Transaction, tenant: string, ticketId: string): Promise<TicketResponsibilityState | null>;
  /** Hands the ticket to client IT. Throws `TicketResponsibilityError` with the provider's refusal code. */
  handToClientIt(db: Knex, input: TicketHandToClientItInput): Promise<TicketResponsibilityState>;
}

// LEVERAGE: pattern global-keyed-registry — same shape as ticketListViews and slaPauseConditions
const STORE_KEY = Symbol.for('alga.tickets.responsibilityProviders');
const providers = (): Map<string, TicketResponsibilityProvider> => {
  const host = globalThis as unknown as Record<symbol, Map<string, TicketResponsibilityProvider> | undefined>;
  return (host[STORE_KEY] ??= new Map());
};

/** Idempotent per id: registering again replaces the earlier registration. */
export function registerTicketResponsibilityProvider(id: string, provider: TicketResponsibilityProvider): void {
  providers().set(id, provider);
}

/** The provider that offers the reader responsibility, if any. */
export async function resolveTicketResponsibility(input: TicketResponsibilityInput): Promise<TicketResponsibilityProvider | null> {
  for (const provider of providers().values()) {
    if (await provider.offered(input)) return provider;
  }
  return null;
}
