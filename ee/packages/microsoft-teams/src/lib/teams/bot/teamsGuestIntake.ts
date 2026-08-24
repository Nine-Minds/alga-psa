import { randomUUID } from 'node:crypto';
import logger from '@alga-psa/core/logger';
import { getSSORegistry } from '@alga-psa/auth';
import { tenantDb, withAdminTransaction } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import type { Knex } from 'knex';
import { TicketModel } from '@shared/models/ticketModel';
import { fetchMicrosoftGraphAppToken } from '../../graphAuth';
import { resolveTeamsMicrosoftProviderConfigImpl } from '../../auth/teamsMicrosoftProviderResolution';
import { getMicrosoftGraphBaseUrl } from '../microsoftEndpoints';
import { getTeamsTicketCreationDefaults } from '../teamsPsaData';
import { resolveDefaultPriorityIdForBoard } from '../actions/teamsActionRegistry';
import {
  computeTeamsAuditPayloadHash,
  writeTeamsAuditEvent,
} from '../actions/teamsAuditRecorder';

/**
 * Guest intake: lets people who are NOT linked MSP users — client contacts,
 * guests, external Teams users — submit tickets from a bot conversation.
 *
 * Identity confidence ladder (highest first):
 *  1. A linked client-portal user (user_auth_accounts, user_type 'client'):
 *     their contact/client attribution is authoritative.
 *  2. Graph directory lookup of the sender's oid in the MSP tenant → mail →
 *     active contact with that email. The Bot Framework JWT already proved
 *     the oid; Graph proves the mailbox it belongs to. (Impossible for
 *     senders in a client's own Microsoft tenant — the MSP app token has no
 *     access to a foreign directory, so the lookup simply misses.)
 *  3. Client-level attribution: tenant resolution already matched the
 *     sender's VERIFIED tid to exactly one active client
 *     (clients.entra_tenant_id). Every employee of that Microsoft tenant is
 *     attributed to the client with no contact — contactId stays null.
 *
 * Unmatched senders are declined politely — no data disclosure, no
 * catch-all creation (that policy tier is a deliberate follow-up).
 */

export interface TeamsGuestSender {
  /** Null for client-level (rung 3) attribution — no individual contact is known. */
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  clientId: string;
  clientName: string | null;
  matchedBy: 'linked_client_user' | 'graph_email_contact' | 'client_entra_tenant';
}

interface ContactRow {
  contact_name_id: string;
  full_name: string | null;
  email: string | null;
  client_id: string | null;
  is_inactive: boolean;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function clientName(db: Knex, tenantId: string, clientId: string): Promise<string | null> {
  const row = await tenantDb(db, tenantId).table('clients')
    .where({ client_id: clientId })
    .first('client_name');
  return normalizeString(row?.client_name) || null;
}

async function contactByEmail(
  db: Knex,
  tenantId: string,
  email: string,
): Promise<ContactRow | undefined> {
  return tenantDb(db, tenantId).table<ContactRow>('contacts')
    .whereRaw('lower(email) = ?', [email.toLowerCase()])
    .andWhere({ is_inactive: false })
    .first(['contact_name_id', 'full_name', 'email', 'client_id', 'is_inactive']);
}

async function resolveLinkedClientContact(
  tenantId: string,
  microsoftAccountId: string,
): Promise<TeamsGuestSender | null> {
  const link = await getSSORegistry().findOAuthAccountLink('microsoft', microsoftAccountId);
  if (!link || link.tenant !== tenantId) {
    return null;
  }

  const db = await getAdminConnection();
  const user = await tenantDb(db, tenantId).table('users')
    .where({ user_id: link.user_id, user_type: 'client', is_inactive: false })
    .first(['user_id', 'contact_id', 'email']);
  const contactId = normalizeString(user?.contact_id);
  if (!contactId) {
    return null;
  }

  const contact = await tenantDb(db, tenantId).table<ContactRow>('contacts')
    .where({ contact_name_id: contactId, is_inactive: false })
    .first(['contact_name_id', 'full_name', 'email', 'client_id', 'is_inactive']);
  if (!contact?.client_id) {
    return null;
  }

  return {
    contactId: contact.contact_name_id,
    contactName: normalizeString(contact.full_name) || null,
    contactEmail: normalizeString(contact.email) || null,
    clientId: contact.client_id,
    clientName: await clientName(db, tenantId, contact.client_id),
    matchedBy: 'linked_client_user',
  };
}

async function lookupSenderMailViaGraph(
  tenantId: string,
  microsoftAccountId: string,
): Promise<string | null> {
  const provider = await resolveTeamsMicrosoftProviderConfigImpl(tenantId);
  if (provider.status !== 'ready' || !provider.clientId || !provider.clientSecret) {
    return null;
  }

  try {
    const accessToken = await fetchMicrosoftGraphAppToken({
      tenantAuthority: provider.microsoftTenantId || 'common',
      clientId: provider.clientId,
      clientSecret: provider.clientSecret,
    });
    const response = await fetch(
      `${getMicrosoftGraphBaseUrl()}/users/${encodeURIComponent(microsoftAccountId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { mail?: unknown; userPrincipalName?: unknown };
    // Guests' userPrincipalName is the mangled #EXT# form; mail is the real
    // external address, so it is the only field contacts can match on.
    return normalizeString(payload.mail) || null;
  } catch (error) {
    logger.warn('[TeamsGuestIntake] Graph sender lookup failed', {
      tenant: tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function resolveEntraMatchedClientSender(
  tenantId: string,
  entraMatchedClientId: string,
): Promise<TeamsGuestSender | null> {
  const db = await getAdminConnection();
  const client = await tenantDb(db, tenantId).table('clients')
    .where({ client_id: entraMatchedClientId, is_inactive: false })
    .first(['client_id', 'client_name']);
  if (!client) {
    return null;
  }

  return {
    contactId: null,
    contactName: null,
    contactEmail: null,
    clientId: entraMatchedClientId,
    clientName: normalizeString(client.client_name) || null,
    matchedBy: 'client_entra_tenant',
  };
}

export async function resolveTeamsGuestSender(params: {
  tenantId: string;
  microsoftAccountId: string | null;
  /**
   * The client matched during tenant resolution via the sender's VERIFIED
   * tid → clients.entra_tenant_id. Enables the client-level fallback rung.
   */
  entraMatchedClientId?: string | null;
}): Promise<TeamsGuestSender | null> {
  const microsoftAccountId = normalizeString(params.microsoftAccountId);
  if (!microsoftAccountId) {
    return null;
  }

  const linked = await resolveLinkedClientContact(params.tenantId, microsoftAccountId);
  if (linked) {
    return linked;
  }

  const mail = await lookupSenderMailViaGraph(params.tenantId, microsoftAccountId);
  if (mail) {
    const db = await getAdminConnection();
    const contact = await contactByEmail(db, params.tenantId, mail);
    if (contact?.client_id) {
      return {
        contactId: contact.contact_name_id,
        contactName: normalizeString(contact.full_name) || null,
        contactEmail: normalizeString(contact.email) || mail,
        clientId: contact.client_id,
        clientName: await clientName(db, params.tenantId, contact.client_id),
        matchedBy: 'graph_email_contact',
      };
    }
  }

  // Rung 3 — strictly a fallback: only reached when the higher-confidence
  // rungs failed, and only when tenant resolution tid-matched a client.
  const entraMatchedClientId = normalizeString(params.entraMatchedClientId);
  if (entraMatchedClientId) {
    return resolveEntraMatchedClientSender(params.tenantId, entraMatchedClientId);
  }

  return null;
}

export type GuestTicketCreationResult =
  | { status: 'created'; ticketId: string; ticketNumber: string; replayed: false }
  | { status: 'replayed'; ticketNumber: string | null; replayed: true }
  | { status: 'unavailable'; reason: string };

/**
 * Idempotent, system-attributed ticket creation for a resolved guest sender.
 * Dedupe rides the same teams_audit_events trail the internal actions use:
 * a prior success row with the same idempotency key + payload hash replays
 * instead of double-creating on a card double-click.
 */
export async function createTeamsGuestTicket(params: {
  tenantId: string;
  sender: TeamsGuestSender;
  microsoftAccountId: string;
  /** Verified sender tid, recorded with client-level (cross-tenant) intake. */
  microsoftTenantId?: string | null;
  title: string;
  description: string;
  idempotencyKey: string;
}): Promise<GuestTicketCreationResult> {
  const { tenantId, sender, microsoftAccountId, idempotencyKey } = params;
  const microsoftTenantId = normalizeString(params.microsoftTenantId) || null;
  const title = normalizeString(params.title).slice(0, 200);
  const description = normalizeString(params.description);
  if (!title) {
    return { status: 'unavailable', reason: 'empty_title' };
  }

  const payloadHash = computeTeamsAuditPayloadHash({
    contactId: sender.contactId,
    title,
    description,
  });

  const db = await getAdminConnection();
  const priorSuccess = await tenantDb(db, tenantId).table('teams_audit_events')
    .where({
      action_id: 'create_ticket_from_message',
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
      result_status: 'success',
    })
    .first(['target_id']);
  if (priorSuccess) {
    return { status: 'replayed', ticketNumber: normalizeString(priorSuccess.target_id) || null, replayed: true };
  }

  const defaults = await getTeamsTicketCreationDefaults({ tenantId });
  if (!defaults.boardId || !defaults.statusId) {
    return { status: 'unavailable', reason: 'no_board_defaults' };
  }
  const priorityId = await resolveDefaultPriorityIdForBoard(tenantId, defaults.boardId);
  if (!priorityId) {
    return { status: 'unavailable', reason: 'no_board_defaults' };
  }

  try {
    const result = await withAdminTransaction(async (trx) => {
      return TicketModel.createTicketWithRetry(
        {
          title,
          description: description || title,
          client_id: sender.clientId,
          // Client-level (rung 3) senders have no contact; the model maps an
          // absent contact_id to a null contact_name_id.
          ...(sender.contactId ? { contact_id: sender.contactId } : {}),
          source: 'teams_guest',
          board_id: defaults.boardId!,
          status_id: defaults.statusId!,
          priority_id: priorityId,
          attributes: {
            teams_guest_intake: {
              matched_by: sender.matchedBy,
              microsoft_account_id: microsoftAccountId,
              ...(microsoftTenantId ? { microsoft_tenant_id: microsoftTenantId } : {}),
            },
          },
        },
        tenantId,
        trx,
      );
    });

    await writeTeamsAuditEvent({
      tenant: tenantId,
      actorUserId: null,
      microsoftUserId: microsoftAccountId,
      surface: 'bot',
      actionId: 'create_ticket_from_message',
      targetType: 'ticket',
      targetId: result.ticket_number,
      idempotencyKey,
      payload: { contactId: sender.contactId, title, description },
      resultStatus: 'success',
    });

    return {
      status: 'created',
      ticketId: result.ticket_id,
      ticketNumber: result.ticket_number,
      replayed: false,
    };
  } catch (error) {
    await writeTeamsAuditEvent({
      tenant: tenantId,
      actorUserId: null,
      microsoftUserId: microsoftAccountId,
      surface: 'bot',
      actionId: 'create_ticket_from_message',
      targetType: 'ticket',
      targetId: null,
      idempotencyKey,
      payload: { contactId: sender.contactId, title, description },
      resultStatus: 'failure',
      errorCode: 'guest_ticket_create_failed',
    });
    logger.error('[TeamsGuestIntake] Guest ticket creation failed', {
      tenant: tenantId,
      contactId: sender.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'unavailable', reason: 'creation_failed' };
  }
}

export function buildGuestTicketIdempotencyKey(): string {
  return randomUUID();
}
