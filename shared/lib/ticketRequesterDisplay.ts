import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

type Connection = Knex | Knex.Transaction;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who a ticket came from, in the terms a notification title can show. */
export interface TicketRequesterIdentity {
  clientName?: string | null;
  contactName?: string | null;
  /** Contact's stored email, or the inbound email sender when no contact matched. */
  senderEmail?: string | null;
}

/** Trimmed display text, or null when empty or a bare id. */
export function usableDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // An id is never a display name; treat a bare UUID as "no name".
  if (!trimmed || UUID_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * The single display rule for "who is this ticket from": contact, then the
 * sender's email, then the client. Returns null when nothing usable exists so
 * callers choose their own wording instead of interpolating an empty string.
 */
export function resolveTicketRequesterLabel(identity: TicketRequesterIdentity): string | null {
  return usableDisplayName(identity.contactName) ?? usableDisplayName(identity.senderEmail) ?? usableDisplayName(identity.clientName);
}

/** Who the ticket is "for": the client, then whoever the ticket came from. */
export function resolveTicketSubjectLabel(identity: TicketRequesterIdentity): string | null {
  return usableDisplayName(identity.clientName) ?? resolveTicketRequesterLabel(identity);
}

function emailFromMetadata(emailMetadata: unknown): string | null {
  const parsed = typeof emailMetadata === 'string'
    ? (() => { try { return JSON.parse(emailMetadata); } catch { return null; } })()
    : emailMetadata;
  const from = parsed && typeof parsed === 'object' ? (parsed as Record<string, any>).from : null;
  if (typeof from === 'string') return usableDisplayName(from);
  return usableDisplayName(from?.email);
}

/**
 * Load the requester identity for a ticket from its client, contact and the
 * inbound email metadata. Used when publishing TICKET_CREATED so workflow
 * authors get real names (and the sender email) instead of reaching for ids.
 */
export async function loadTicketRequesterIdentity(
  conn: Connection,
  tenant: string,
  input: { client_id?: string | null; contact_id?: string | null; email_metadata?: unknown },
): Promise<TicketRequesterIdentity> {
  const db = tenantDb(conn, tenant);
  const identity: TicketRequesterIdentity = {};
  if (input.client_id) {
    const client = await db.table('clients').select('client_name').where({ client_id: input.client_id }).first();
    identity.clientName = usableDisplayName(client?.client_name);
  }
  let contactEmail: string | null = null;
  if (input.contact_id) {
    const contact = await db.table('contacts').select('full_name', 'email').where({ contact_name_id: input.contact_id }).first();
    identity.contactName = usableDisplayName(contact?.full_name);
    contactEmail = usableDisplayName(contact?.email);
  }
  identity.senderEmail = emailFromMetadata(input.email_metadata) ?? contactEmail;
  return identity;
}
