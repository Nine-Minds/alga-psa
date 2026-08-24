'use server';

import { hasPermission } from '@alga-psa/auth/rbac';
import { withAuth } from '@alga-psa/auth/withAuth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { getTelephonyAvailability } from '../../lib/telephonyAvailability';

export interface TelephonyProviderCard {
  provider: string;
  status: 'not_configured' | 'active' | 'disabled' | 'error';
  autoCreateTickets: boolean;
  subscriptionId: string | null;
  subscriptionExpiresAt: string | null;
  lastError: string | null;
  lastNotificationAt: string | null;
  /** Teams Phone additionally needs a Teams-capable Microsoft profile. */
  prerequisiteMet: boolean;
}

export interface TelephonyCallSummary {
  callRecordId: string;
  provider: string;
  direction: string;
  counterpartyNumber: string | null;
  counterpartyLabel: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  matchStatus: string;
  matchedContactId: string | null;
  matchedContactName: string | null;
  matchedClientId: string | null;
  matchedClientName: string | null;
  interactionId: string | null;
  ticketId: string | null;
  candidates: Array<{ contactId?: string | null; clientId?: string | null; contactName?: string | null }>;
}

export interface TelephonyLinkableTicket {
  ticketId: string;
  ticketNumber: string | null;
  title: string;
  statusName: string | null;
}

export interface TelephonyResolutionTarget {
  contactId: string | null;
  clientId: string | null;
  label: string;
  sublabel: string | null;
}

export interface TelephonyOverview {
  success: boolean;
  error?: string;
  available: boolean;
  reason?: string;
  canManage: boolean;
  providers: TelephonyProviderCard[];
  recentCalls: TelephonyCallSummary[];
  unresolvedCalls: TelephonyCallSummary[];
}

async function canManageTelephony(user: unknown): Promise<boolean> {
  return hasPermission(user as any, 'system_settings', 'update');
}

function isClientPortalUser(user: any): boolean {
  return user?.user_type === 'client';
}

/**
 * Every telephony surface reads or writes the tenant-wide call log, which
 * carries counterparty numbers and client attribution. Gate it exactly like the
 * Teams settings surface it lives under: never the client portal, and only an
 * admin who may change integration settings.
 */
async function requireTelephonyAdmin(user: unknown): Promise<string | null> {
  if (isClientPortalUser(user)) {
    return 'Forbidden';
  }
  if (!(await canManageTelephony(user))) {
    return 'Permission denied: telephony settings require system settings update permission.';
  }
  return null;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function counterpartyOf(row: any): { number: string | null } {
  return {
    number: row.direction === 'outbound'
      ? row.callee_number_e164 ?? row.callee_number_raw ?? null
      : row.caller_number_e164 ?? row.caller_number_raw ?? null,
  };
}

function toSummary(row: any): TelephonyCallSummary {
  const candidates = Array.isArray(row.match_candidates)
    ? row.match_candidates
    : typeof row.match_candidates === 'string'
      ? JSON.parse(row.match_candidates || '[]')
      : [];

  return {
    callRecordId: row.call_record_id,
    provider: row.provider,
    direction: row.direction,
    counterpartyNumber: counterpartyOf(row).number,
    counterpartyLabel: row.contact_full_name ?? row.client_name ?? null,
    startedAt: toIso(row.started_at),
    durationSeconds: row.duration_seconds ?? null,
    matchStatus: row.match_status,
    matchedContactId: row.matched_contact_id ?? null,
    matchedContactName: row.contact_full_name ?? null,
    matchedClientId: row.matched_client_id ?? null,
    matchedClientName: row.client_name ?? null,
    interactionId: row.interaction_id ?? null,
    ticketId: row.ticket_id ?? null,
    candidates,
  };
}

async function listCalls(tenant: string, options: { unresolvedOnly?: boolean; limit?: number } = {}) {
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);
  const query = db.table('telephony_call_records as tcr');
  db.tenantJoin(query, 'contacts as c', 'tcr.matched_contact_id', 'c.contact_name_id', { type: 'left' });
  db.tenantJoin(query, 'clients as cl', 'tcr.matched_client_id', 'cl.client_id', { type: 'left' });

  if (options.unresolvedOnly) {
    // "Needs a human" is the absence of an interaction, not just an unmatched
    // status: a contact with no client matches the ladder but cannot be filed
    // on any timeline, and would otherwise never appear in the queue.
    query.whereNull('tcr.interaction_id').andWhere((builder: any) => {
      builder.whereIn('tcr.match_status', ['unmatched', 'ambiguous']).orWhereNull('tcr.matched_client_id');
    });
  }

  return query
    .select(
      'tcr.call_record_id',
      'tcr.provider',
      'tcr.direction',
      'tcr.caller_number_raw',
      'tcr.caller_number_e164',
      'tcr.callee_number_raw',
      'tcr.callee_number_e164',
      'tcr.started_at',
      'tcr.duration_seconds',
      'tcr.match_status',
      'tcr.matched_contact_id',
      'tcr.matched_client_id',
      'tcr.match_candidates',
      'tcr.interaction_id',
      'tcr.ticket_id',
      'c.full_name as contact_full_name',
      'cl.client_name as client_name',
    )
    .orderBy('tcr.started_at', 'desc')
    .limit(options.limit ?? 20);
}

type EeTelephonyModule = typeof import('@alga-psa/ee-microsoft-teams/lib');

async function loadEeTelephony(): Promise<EeTelephonyModule> {
  return import('@alga-psa/ee-microsoft-teams/lib') as Promise<EeTelephonyModule>;
}

export const getTelephonyOverview = withAuth(async (user, { tenant }): Promise<TelephonyOverview> => {
  const denied = await requireTelephonyAdmin(user);
  if (denied) {
    return {
      success: false,
      error: denied,
      available: false,
      canManage: false,
      providers: [],
      recentCalls: [],
      unresolvedCalls: [],
    };
  }

  // Past the gate the caller is, by definition, an admin who may manage this.
  const canManage = true;
  const availability = await getTelephonyAvailability({ tenantId: tenant });

  if (availability.enabled === false) {
    return {
      success: true,
      available: false,
      reason: availability.reason,
      error: availability.message,
      canManage,
      providers: [],
      recentCalls: [],
      unresolvedCalls: [],
    };
  }

  const ee = await loadEeTelephony();
  const teamsPhone = await ee.getTeamsPhoneProviderState(tenant);

  const [recent, unresolved] = await Promise.all([
    listCalls(tenant, { limit: 10 }),
    listCalls(tenant, { unresolvedOnly: true, limit: 25 }),
  ]);

  return {
    success: true,
    available: true,
    canManage,
    providers: [
      {
        provider: teamsPhone.provider,
        status: teamsPhone.status,
        autoCreateTickets: teamsPhone.autoCreateTickets,
        subscriptionId: teamsPhone.subscriptionId,
        subscriptionExpiresAt: teamsPhone.subscriptionExpiresAt,
        lastError: teamsPhone.lastError,
        lastNotificationAt: teamsPhone.lastNotificationAt,
        prerequisiteMet: teamsPhone.teamsConfigured,
      },
    ],
    recentCalls: recent.map(toSummary),
    unresolvedCalls: unresolved.map(toSummary),
  };
});

/**
 * Entitlement + authorization for every mutating telephony action. The add-on
 * lookup is what stops provider activation and subscription creation on a
 * tenant that is not entitled to Teams — the ingestion path is deny-by-default,
 * but nothing else was re-checking it.
 */
async function requireManageableTenant(user: unknown, tenant: string): Promise<string | null> {
  const availability = await getTelephonyAvailability({ tenantId: tenant });
  if (availability.enabled === false) {
    return availability.message;
  }
  return requireTelephonyAdmin(user);
}

export const setTelephonyProviderEnabled = withAuth(async (
  user,
  { tenant },
  input: { provider: string; enabled: boolean },
): Promise<{ success: boolean; error?: string }> => {
  const denied = await requireManageableTenant(user, tenant);
  if (denied) {
    return { success: false, error: denied };
  }

  const ee = await loadEeTelephony();
  try {
    if (input.enabled) {
      await ee.activateTeamsPhoneProvider(tenant);
    } else {
      await ee.deactivateTeamsPhoneProvider(tenant);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

export const setTelephonyAutoTicketPolicy = withAuth(async (
  user,
  { tenant },
  input: { provider: string; autoCreateTickets: boolean },
): Promise<{ success: boolean; error?: string }> => {
  const denied = await requireManageableTenant(user, tenant);
  if (denied) {
    return { success: false, error: denied };
  }

  const ee = await loadEeTelephony();
  await ee.setTeamsPhoneAutoTicketPolicy(tenant, input.autoCreateTickets);
  return { success: true };
});

export const resolveTelephonyCall = withAuth(async (
  user,
  { tenant },
  input: { callRecordId: string; contactId?: string | null; clientId?: string | null },
): Promise<{ success: boolean; error?: string; interactionId?: string | null }> => {
  // Resolving stamps contact/client attribution onto a call and mints an
  // interaction, so it is a manage action, not a read one.
  const denied = await requireManageableTenant(user, tenant);
  if (denied) {
    return { success: false, error: denied };
  }

  const { resolveCallMatch } = await import('@alga-psa/telephony');
  try {
    const outcome = await resolveCallMatch({
      tenantId: tenant,
      callRecordId: input.callRecordId,
      contactId: input.contactId ?? null,
      clientId: input.clientId ?? null,
      actingUserId: (user as any)?.user_id ?? null,
    });

    if (outcome.status === 'not_found') {
      return { success: false, error: 'Call not found.' };
    }

    return { success: true, interactionId: outcome.interactionId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

/**
 * Attribution targets for a call the ladder could not place. Unmatched calls
 * carry no candidates by definition (that is what unmatched means), so the
 * queue needs a searchable picker or those calls are a dead end — and while
 * contact numbers are unnormalized that is the common case, not the rare one.
 */
export const listTelephonyResolutionTargets = withAuth(async (
  user,
  { tenant },
  input: { search?: string } = {},
): Promise<{ success: boolean; error?: string; targets: TelephonyResolutionTarget[] }> => {
  const availability = await getTelephonyAvailability({ tenantId: tenant });
  if (availability.enabled === false) {
    return { success: false, error: availability.message, targets: [] };
  }

  const { knex } = await createTenantKnex(tenant);
  const [canReadContacts, canReadClients] = await Promise.all([
    hasPermission(user as any, 'contact', 'read', knex),
    hasPermission(user as any, 'client', 'read', knex),
  ]);

  if (!canReadContacts && !canReadClients) {
    return { success: false, error: 'Permission denied: Cannot read contacts or clients', targets: [] };
  }

  const search = (input.search ?? '').trim();
  const like = `%${search.replace(/[%_]/g, (match) => `\\${match}`)}%`;
  const db = tenantDb(knex, tenant);
  const targets: TelephonyResolutionTarget[] = [];

  if (canReadContacts) {
    const contactQuery = db.table('contacts as c');
    db.tenantJoin(contactQuery, 'clients as cl', 'c.client_id', 'cl.client_id', { type: 'left' });
    if (search) {
      contactQuery.where('c.full_name', 'ilike', like);
    }
    const contacts = await contactQuery
      .where('c.is_inactive', false)
      .select('c.contact_name_id', 'c.full_name', 'c.client_id', 'cl.client_name')
      .orderBy('c.full_name', 'asc')
      .limit(20);

    targets.push(...contacts.map((row: any) => ({
      contactId: row.contact_name_id,
      clientId: row.client_id ?? null,
      label: row.full_name ?? '',
      sublabel: row.client_name ?? null,
    })));
  }

  if (canReadClients) {
    const clientQuery = db.table('clients');
    if (search) {
      clientQuery.where('client_name', 'ilike', like);
    }
    const clients = await clientQuery
      .where('is_inactive', false)
      .select('client_id', 'client_name')
      .orderBy('client_name', 'asc')
      .limit(20);

    targets.push(...clients.map((row: any) => ({
      contactId: null,
      clientId: row.client_id,
      label: row.client_name ?? '',
      sublabel: null,
    })));
  }

  return { success: true, targets };
});

/**
 * Tickets a captured call can be filed against. Scoped to the call's matched
 * client so the picker cannot cross client boundaries, and to open tickets so
 * it does not grow unbounded on long-lived tenants.
 */
export const listTelephonyLinkableTickets = withAuth(async (
  user,
  { tenant },
  input: { callRecordId: string },
): Promise<{ success: boolean; error?: string; tickets: TelephonyLinkableTicket[] }> => {
  const availability = await getTelephonyAvailability({ tenantId: tenant });
  if (availability.enabled === false) {
    return { success: false, error: availability.message, tickets: [] };
  }

  const { knex } = await createTenantKnex(tenant);
  if (!(await hasPermission(user as any, 'ticket', 'read', knex))) {
    return { success: false, error: 'Permission denied: Cannot read tickets', tickets: [] };
  }

  const db = tenantDb(knex, tenant);
  const record = await db.table('telephony_call_records')
    .where({ call_record_id: input.callRecordId })
    .first('matched_client_id');

  if (!record) {
    return { success: false, error: 'Call not found.', tickets: [] };
  }
  if (!record.matched_client_id) {
    return { success: false, error: 'Resolve this call to a contact or client before linking it to a ticket.', tickets: [] };
  }

  const query = db.table('tickets as t');
  db.tenantJoin(query, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });

  const rows = await query
    .where('t.client_id', record.matched_client_id)
    .andWhere((builder: any) => builder.where('s.is_closed', false).orWhereNull('s.is_closed'))
    .select('t.ticket_id', 't.ticket_number', 't.title', 's.name as status_name')
    .orderBy('t.entered_at', 'desc')
    .limit(50);

  return {
    success: true,
    tickets: rows.map((row: any) => ({
      ticketId: row.ticket_id,
      ticketNumber: row.ticket_number ?? null,
      title: row.title ?? '',
      statusName: row.status_name ?? null,
    })),
  };
});

export const linkTelephonyCallToTicket = withAuth(async (
  user,
  { tenant },
  input: { callRecordId: string; ticketId: string },
): Promise<{ success: boolean; error?: string }> => {
  const availability = await getTelephonyAvailability({ tenantId: tenant });
  if (availability.enabled === false) {
    return { success: false, error: availability.message };
  }

  const { knex } = await createTenantKnex(tenant);
  if (!(await hasPermission(user as any, 'ticket', 'update', knex))) {
    return { success: false, error: 'Permission denied: Cannot update ticket' };
  }

  return withTransaction(knex, async (trx: any) => {
    const db = tenantDb(trx, tenant);
    const record = await db.table('telephony_call_records')
      .where({ call_record_id: input.callRecordId })
      .first();

    if (!record) {
      return { success: false, error: 'Call not found.' };
    }
    if (!record.interaction_id) {
      return { success: false, error: 'Resolve this call to a contact or client before linking it to a ticket.' };
    }

    // The picker cannot offer another client's ticket, but this action is
    // callable directly — re-check the boundary here or a crafted ticketId
    // cross-links the call onto a ticket the caller's client never owned.
    const ticket = await db.table('tickets')
      .where({ ticket_id: input.ticketId })
      .first('client_id');

    if (!ticket || ticket.client_id !== record.matched_client_id) {
      return { success: false, error: 'That ticket does not belong to the client this call is attributed to.' };
    }

    await db.table('interactions')
      .where({ interaction_id: record.interaction_id })
      .update({ ticket_id: input.ticketId });

    await db.table('telephony_call_records')
      .where({ call_record_id: input.callRecordId })
      .update({ ticket_id: input.ticketId, updated_at: trx.fn.now() });

    return { success: true };
  });
});

export const createTicketFromTelephonyCall = withAuth(async (
  user,
  { tenant },
  input: { callRecordId: string; title?: string },
): Promise<{ success: boolean; error?: string; ticketId?: string; ticketNumber?: string }> => {
  const availability = await getTelephonyAvailability({ tenantId: tenant });
  if (availability.enabled === false) {
    return { success: false, error: availability.message };
  }

  const { knex } = await createTenantKnex(tenant);
  if (!(await hasPermission(user as any, 'ticket', 'create', knex))) {
    return { success: false, error: 'Permission denied: Cannot create ticket' };
  }

  const record = await tenantDb(knex, tenant).table('telephony_call_records')
    .where({ call_record_id: input.callRecordId })
    .first();

  if (!record) {
    return { success: false, error: 'Call not found.' };
  }
  if (!record.matched_client_id) {
    return { success: false, error: 'Resolve this call to a client before creating a ticket.' };
  }

  const ee = await loadEeTelephony();
  const defaults = await ee.getTeamsTicketCreationDefaults({ tenantId: tenant });
  if (!defaults.boardId || !defaults.statusId) {
    return { success: false, error: 'No default board and open status are configured for tickets.' };
  }
  const priorityId = await ee.resolveDefaultPriorityIdForBoard(tenant, defaults.boardId);
  if (!priorityId) {
    return { success: false, error: 'No default priority is configured for the default board.' };
  }

  const { buildCallInteractionNotes, buildCallInteractionTitle } = await import('@alga-psa/telephony');
  const titleInput = {
    direction: record.direction,
    callerNumberE164: record.caller_number_e164,
    callerNumberRaw: record.caller_number_raw,
    calleeNumberE164: record.callee_number_e164,
    calleeNumberRaw: record.callee_number_raw,
  };

  try {
    return await withTransaction(knex, async (trx: any) => {
      const created = await TicketModel.createTicketWithRetry(
        {
          title: input.title?.trim() || buildCallInteractionTitle(titleInput),
          description: buildCallInteractionNotes({ ...titleInput, provider: record.provider, durationSeconds: record.duration_seconds }),
          client_id: record.matched_client_id,
          contact_id: record.matched_contact_id ?? undefined,
          board_id: defaults.boardId!,
          status_id: defaults.statusId!,
          priority_id: priorityId,
          entered_by: (user as any)?.user_id,
          source: 'telephony',
        } as any,
        tenant,
        trx,
        {},
        undefined,
        undefined,
        (user as any)?.user_id,
        3,
      );

      const db = tenantDb(trx, tenant);
      if (record.interaction_id) {
        await db.table('interactions')
          .where({ interaction_id: record.interaction_id })
          .update({ ticket_id: created.ticket_id });
      }
      await db.table('telephony_call_records')
        .where({ call_record_id: input.callRecordId })
        .update({ ticket_id: created.ticket_id, updated_at: trx.fn.now() });

      return { success: true, ticketId: created.ticket_id, ticketNumber: created.ticket_number };
    });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});
