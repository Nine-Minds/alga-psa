import logger from '@alga-psa/core/logger';
import { createTenantKnex, runWithTenant, tenantDb } from '@alga-psa/db';
import { broadcastTelephonyIncomingCall } from '@alga-psa/notifications/realtime/internalNotificationBroadcaster';
import { formatCallNumber, normalizeToE164 } from '@alga-psa/telephony/lib/phoneNumbers';
import type {
  CallMatchResult,
  IncomingCallClient,
  IncomingCallContact,
  IncomingCallInteraction,
  IncomingCallMessage,
  IncomingCallTicket,
} from '@alga-psa/telephony/types';

export const THREECX_CALL_EVENT_JOB = 'process-threecx-call-event';

export type ThreecxCallEventKind = 'ringing' | 'connected' | 'ended';

export interface ThreecxCallEvent {
  kind: ThreecxCallEventKind;
  /** Extension (DN) the call is ringing on. */
  dn: string;
  participantId: string;
  callId: string;
  partyCallerId?: string | null;
  partyCallerName?: string | null;
  partyDid?: string | null;
  at: string;
}

export interface ThreecxCallEventJobData extends Record<string, unknown> {
  tenantId: string;
  event: ThreecxCallEvent;
}

type EeThreecxModule = {
  getThreecxProviderConfig: (tenantId: string, knex?: any) => Promise<{ config: any } | null>;
  userForExtension: (config: any, dn: string | null | undefined) => string | null;
};

type TelephonyModule = {
  matchCallParty: (input: { knex: any; tenantId: string; phoneNumber: string | null | undefined; defaultCountryCode?: string | null }) => Promise<CallMatchResult>;
  resolveTenantPhoneCountryCode: (knex: any, tenantId: string) => Promise<string | null>;
};

const OPEN_TICKET_LIMIT = 5;
const RECENT_INTERACTION_LIMIT = 3;

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

/** Data access the ringing payload needs; swapped for fakes in tests. */
export interface IncomingCallLookups {
  matchCallParty: (phoneNumber: string | null | undefined) => Promise<CallMatchResult>;
  loadContact: (contactId: string) => Promise<(IncomingCallContact & { clientId: string | null }) | null>;
  loadClient: (clientId: string) => Promise<IncomingCallClient | null>;
  loadOpenTickets: (scope: { contactId: string } | { clientId: string }) => Promise<IncomingCallTicket[]>;
  loadRecentInteractions: (contactId: string) => Promise<IncomingCallInteraction[]>;
}

export function createIncomingCallLookups(params: {
  knex: any;
  tenantId: string;
  defaultCountryCode: string | null;
  matchCallParty: TelephonyModule['matchCallParty'];
}): IncomingCallLookups {
  const { knex, tenantId, defaultCountryCode } = params;
  const db = tenantDb(knex, tenantId);

  return {
    matchCallParty: (phoneNumber) =>
      params.matchCallParty({ knex, tenantId, phoneNumber, defaultCountryCode }),

    loadContact: async (contactId) => {
      const row = await db.table('contacts')
        .where({ contact_name_id: contactId })
        .first('contact_name_id', 'full_name', 'email', 'client_id');
      if (!row) return null;
      const phone = await db.table('contact_phone_numbers')
        .where({ contact_name_id: contactId })
        .orderBy([{ column: 'is_default', order: 'desc' }, { column: 'display_order', order: 'asc' }])
        .first('phone_number');
      return {
        id: row.contact_name_id,
        name: row.full_name ?? '',
        email: row.email ?? null,
        phone: phone?.phone_number ?? null,
        clientId: row.client_id ?? null,
      };
    },

    loadClient: async (clientId) => {
      const row = await db.table('clients')
        .where({ client_id: clientId })
        .first('client_id', 'client_name');
      return row ? { id: row.client_id, name: row.client_name ?? '' } : null;
    },

    loadOpenTickets: async (scope) => {
      const query = db.table('tickets as t');
      db.tenantJoin(query, 'statuses as s', 't.status_id', 's.status_id');
      const rows: Array<{ ticket_id: string; ticket_number: string; title: string; status_name: string | null }> =
        await query
          .where('contactId' in scope ? { 't.contact_name_id': scope.contactId } : { 't.client_id': scope.clientId })
          .where('s.is_closed', false)
          .orderBy('t.updated_at', 'desc')
          .limit(OPEN_TICKET_LIMIT)
          .select('t.ticket_id', 't.ticket_number', 't.title', 's.name as status_name');
      return rows.map((row) => ({
        id: row.ticket_id,
        number: row.ticket_number,
        title: row.title,
        status: row.status_name ?? null,
      }));
    },

    loadRecentInteractions: async (contactId) => {
      const query = db.table('interactions as i');
      db.tenantJoin(query, 'interaction_types as it', 'i.type_id', 'it.type_id', { type: 'left' });
      db.tenantJoin(query, 'system_interaction_types as sit', 'i.type_id', 'sit.type_id', { type: 'left' });
      const rows: Array<{ interaction_id: string; title: string | null; interaction_date: string | Date; type_name: string | null }> =
        await query
          .where('i.contact_name_id', contactId)
          .orderBy('i.interaction_date', 'desc')
          .limit(RECENT_INTERACTION_LIMIT)
          .select(
            'i.interaction_id',
            'i.title',
            'i.interaction_date',
            knex.raw('COALESCE(it.type_name, sit.type_name) as type_name'),
          );
      return rows.map((row) => ({
        id: row.interaction_id,
        type: row.type_name ?? null,
        title: row.title ?? '',
        date: row.interaction_date instanceof Date ? row.interaction_date.toISOString() : String(row.interaction_date),
      }));
    },
  };
}

/**
 * Shapes the realtime message for one PBX event. Only `ringing` looks anything
 * up: the card needs the caller's context before the agent answers, while
 * `connected`/`ended` exist solely to close it.
 */
export async function buildIncomingCallPayload(
  event: ThreecxCallEvent,
  lookups: IncomingCallLookups,
  defaultCountryCode: string | null,
): Promise<IncomingCallMessage> {
  const identity = { callId: event.callId, participantId: event.participantId, dn: event.dn };
  if (event.kind !== 'ringing') {
    return { event: event.kind, call: identity };
  }

  const raw = event.partyCallerId ?? null;
  const numberE164 = normalizeToE164(raw, { defaultCountryCode });
  const match = await lookups.matchCallParty(numberE164 ?? raw);

  let contact: IncomingCallContact | null = null;
  let clientId: string | null = match.clientId;
  if (match.status === 'matched' && match.contactId) {
    const loaded = await lookups.loadContact(match.contactId);
    if (loaded) {
      const { clientId: contactClientId, ...rest } = loaded;
      contact = rest;
      clientId = clientId ?? contactClientId;
    }
  }
  const client = match.status === 'matched' && clientId ? await lookups.loadClient(clientId) : null;

  let tickets: IncomingCallTicket[] = [];
  if (contact) {
    tickets = await lookups.loadOpenTickets({ contactId: contact.id });
  }
  if (tickets.length === 0 && client) {
    tickets = await lookups.loadOpenTickets({ clientId: client.id });
  }
  const interactions = contact ? await lookups.loadRecentInteractions(contact.id) : [];

  return {
    event: 'ringing',
    call: {
      ...identity,
      number: formatCallNumber(numberE164, raw),
      numberE164,
      callerName: contact?.name || event.partyCallerName || null,
      matchStatus: match.status,
      contact,
      client,
      tickets,
      interactions,
      at: event.at,
    },
  };
}

export async function processThreecxCallEvent(data: ThreecxCallEventJobData): Promise<void> {
  if (!isEnterpriseEdition) {
    logger.info('[Telephony] Skipping 3CX call event outside Enterprise Edition', { tenantId: data.tenantId });
    return;
  }

  await runWithTenant(data.tenantId, async () => {
    const { knex } = await createTenantKnex(data.tenantId);
    const threecx = (await import('@alga-psa/ee-threecx/lib')) as EeThreecxModule;
    const provider = await threecx.getThreecxProviderConfig(data.tenantId, knex);
    const userId = provider ? threecx.userForExtension(provider.config, data.event.dn) : null;
    if (!userId) {
      logger.info('[Telephony] Dropping 3CX call event for unmapped extension', {
        tenantId: data.tenantId,
        dn: data.event.dn,
        kind: data.event.kind,
      });
      return;
    }

    const telephony = (await import('@alga-psa/telephony')) as TelephonyModule;
    const defaultCountryCode =
      data.event.kind === 'ringing' ? await telephony.resolveTenantPhoneCountryCode(knex, data.tenantId) : null;
    const lookups = createIncomingCallLookups({
      knex,
      tenantId: data.tenantId,
      defaultCountryCode,
      matchCallParty: telephony.matchCallParty,
    });
    const message = await buildIncomingCallPayload(data.event, lookups, defaultCountryCode);

    await broadcastTelephonyIncomingCall(data.tenantId, userId, {
      event: message.event,
      call: message.call as unknown as Record<string, unknown>,
    });
  });
}
