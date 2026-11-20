import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { authorizeTicketRecordAccess } from '@alga-psa/tickets/lib/ticketRecordAuthorization';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { getConnection } from '@/lib/db/db';
import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { hasPermission } from '@alga-psa/auth/rbac';
import { extractTicketRichTextPlainText } from '@alga-psa/tickets/lib/ticketRichText';
import { admitSeatTrialCredential } from '@enterprise/lib/co-managed/seatTrialSession';
import { getHocuspocusJwtSecret } from '@/lib/hocuspocusJwt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasRelayKey(request: NextRequest) {
  const expected = process.env.COLLAB_PERSIST_API_KEY;
  return Boolean(expected && request.headers.get('x-api-key') === expected);
}

async function readAuthorizedTicket(trx: Knex.Transaction, tenantId: string, userId: string, ticketId: string) {
  const scoped = tenantDb(trx, tenantId);
  const user = await scoped.table('users').where({ user_id: userId, is_inactive: false }).first() as IUserWithRoles | undefined;
  if (!user || user.user_type !== 'internal' || !(await hasPermission(user, 'ticket', 'read', trx))) return null;
  const ticket = await scoped.table('tickets').where({ ticket_id: ticketId }).first();
  if (!ticket) return null;
  await authorizeTicketRecordAccess({ trx, tenant: tenantId, user, ticketId, action: 'read', ticketRow: ticket });
  return { scoped, user, ticket };
}

function isTicketReadDenied(error: unknown) {
  return error instanceof Error && (error.message.includes('Permission denied') || error.message === 'Ticket not found');
}

async function readRelayTicketReader(token: string) {
  const secret = await getHocuspocusJwtSecret();
  try {
    const claims = jwt.verify(token, secret, { algorithms: ['HS256'], audience: 'ticket-live-access', maxAge: 15 });
    const reader = typeof claims === 'object' ? claims.ticketReader : null;
    if (typeof reader?.tenantId !== 'string' || !reader.tenantId ||
        typeof reader?.userId !== 'string' || !reader.userId ||
        typeof reader?.ticketId !== 'string' || !reader.ticketId) return null;
    return { tenantId: reader.tenantId, userId: reader.userId, ticketId: reader.ticketId };
  } catch {
    return null;
  }
}

export async function HEAD(request: NextRequest) {
  const respond = (status: number) => new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store, private' } });
  const token = request.headers.get('x-api-key');
  if (!token) return respond(401);

  try {
    const reader = await readRelayTicketReader(token);
    if (!reader) return respond(401);
    const { tenantId, userId, ticketId } = reader;
    const db = await getConnection(tenantId);
    const allowed = await withTransaction(db, async trx => {
      if (!await admitSeatTrialCredential(tenantId, userId, trx)) return false;
      return Boolean(await readAuthorizedTicket(trx, tenantId, userId, ticketId));
    });
    return respond(allowed ? 204 : 403);
  } catch (error) {
    if (isTicketReadDenied(error)) return respond(403);
    console.error('[ticket-live-change] Failed to check ticket room access', error);
    return respond(503);
  }
}

export async function POST(request: NextRequest) {
  if (!hasRelayKey(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null) as null | {
    tenantId?: string; userId?: string; ticketId?: string; event?: Record<string, unknown>;
  };
  const { tenantId, userId, ticketId, event } = body ?? {};
  if (!tenantId || !userId || !ticketId || !event || typeof event.updatedAt !== 'string') {
    return NextResponse.json({ error: 'Invalid change request' }, { status: 400 });
  }

  try {
    const db = await getConnection(tenantId);
    const change = await withTransaction(db, async (trx) => {
      const access = await readAuthorizedTicket(trx, tenantId, userId, ticketId);
      if (!access) return null;
      const { scoped, user, ticket } = access;

      const status = await scoped.table('statuses').where({ status_id: ticket.status_id }).first('is_closed', 'name');
      const board = ticket.board_id
        ? await scoped.table('boards').where({ board_id: ticket.board_id }).first('is_inactive')
        : undefined;
      const serviceRequest = await scoped.table('service_request_submissions').where({ created_ticket_id: ticketId }).first('definition_id');
      const extraAssignees = await scoped.table('ticket_resources').where({ ticket_id: ticketId }).pluck('additional_user_id');
      const searchableComments = await scoped.table('app_search_index')
        .where({ object_type: 'ticket_comment', parent_type: 'ticket', parent_id: ticketId })
        .where(builder => builder.whereNull('required_permission').orWhere('required_permission', 'ticket:read'))
        .where(builder => builder.whereRaw('cardinality(visible_to_user_ids) = 0').orWhereRaw('visible_to_user_ids && ARRAY[?]::uuid[]', [userId]))
        .where(builder => builder.where('is_private', false).orWhereRaw('visible_to_user_ids && ARRAY[?]::uuid[]', [userId]))
        .select('title', 'subtitle', 'body');
      const tagRows = await scoped.tenantJoin(scoped.table('tag_mappings as tm'), 'tag_definitions as td', 'tm.tag_id', 'td.tag_id')
        .where({ 'tm.tagged_id': ticketId, 'tm.tagged_type': 'ticket' }).select('td.tag_id', 'td.tag_text');
      const clientTagRows = ticket.client_id ? await scoped.table('tag_mappings')
        .where({ tagged_id: ticket.client_id, tagged_type: 'client' }).select('tag_id') : [];
      const contactTagRows = ticket.contact_name_id ? await scoped.table('tag_mappings')
        .where({ tagged_id: ticket.contact_name_id, tagged_type: 'contact' }).select('tag_id') : [];
      const tags = tagRows.map((tag: { tag_text: string }) => tag.tag_text);
      const teamIds = ticket.assigned_team_id ? [ticket.assigned_team_id] : [];
      const primaryAssigneeId = typeof ticket.assigned_to === 'string' ? ticket.assigned_to : null;
      const teamMember = ticket.assigned_team_id ? await scoped.table('team_members')
        .where({ team_id: ticket.assigned_team_id, user_id: userId }).first('user_id') : null;
      const involved = primaryAssigneeId === userId || extraAssignees.includes(userId) || Boolean(teamMember);
      const assignedToMeBypass = await hasPermission(user, 'project', 'read', trx);
      const assigneeIds = primaryAssigneeId ? [primaryAssigneeId] : [];
      const fields = Array.isArray(event.changedFields) ? event.changedFields.filter((field): field is string => typeof field === 'string') : [];
      const filterRecord: Record<string, unknown> = {
        ticket_origin: ticket.ticket_origin ?? null,
        board_id: ticket.board_id ?? null,
        status_id: ticket.status_id ?? null,
        priority_id: ticket.priority_id ?? null,
        category_id: ticket.category_id ?? null,
        subcategory_id: ticket.subcategory_id ?? null,
        assigned_to: ticket.assigned_to ?? null,
        assigned_team_id: ticket.assigned_team_id ?? null,
        master_ticket_id: ticket.master_ticket_id ?? null,
        sla_policy_id: ticket.sla_policy_id ?? null,
        due_date: ticket.due_date ?? null,
        response_state: ticket.response_state ?? null,
        board_inactive: board ? Boolean(board.is_inactive) : false,
        status_closed: Boolean(status?.is_closed),
        status_name: status?.name,
        category: [ticket.category_id, ticket.subcategory_id].filter(Boolean),
        tags: tagRows.map((tag: { tag_id: string }) => tag.tag_id),
        involves_user: involved ? userId : null,
        from_service_request: Boolean(serviceRequest),
        service_request_definition_id: serviceRequest?.definition_id ?? null,
        sla_state: null,
        client: { id: ticket.client_id ?? null, tags: clientTagRows.map((tag: { tag_id: string }) => tag.tag_id) },
        contact: { id: ticket.contact_name_id ?? null, tags: contactTagRows.map((tag: { tag_id: string }) => tag.tag_id) },
      };
      filterRecord.title_folded = String(ticket.title ?? '').toLocaleLowerCase();
      const description = ticket.attributes?.description ?? ticket.description ?? null;
      if (description !== null) filterRecord.description_folded = extractTicketRichTextPlainText(description).toLocaleLowerCase();
      const now = Date.now();
      const breached = Boolean(ticket.sla_policy_id && (
        (ticket.sla_response_due_at && new Date(ticket.sla_response_due_at).getTime() < now && !ticket.sla_response_at) ||
        (ticket.sla_resolution_due_at && new Date(ticket.sla_resolution_due_at).getTime() < now && !ticket.sla_resolution_at) ||
        ticket.sla_response_met === false || ticket.sla_resolution_met === false
      ));
      const slaStatus = !ticket.sla_policy_id ? 'no_sla' : ticket.sla_paused_at ? 'paused' : breached ? 'breached' : 'on_track';
      filterRecord.sla_state = slaStatus === 'no_sla' ? null : slaStatus;
      return {
        ticketId, changeKind: event.changeKind === 'created' ? 'created' : 'updated',
        boardId: ticket.board_id ?? null, statusId: ticket.status_id ?? null, assigneeIds,
        statusName: status?.name,
        primaryAssigneeId, involvedUserIds: involved ? [userId] : [],
        timeZone: user.timezone ?? 'UTC',
        assignedToMeBypass,
        searchText: [ticket.ticket_number, ticket.title, ticket.description,
          ...searchableComments.flatMap((row: { title?: string | null; subtitle?: string | null; body?: string | null }) => [row.title, row.subtitle, row.body])]
          .filter(Boolean).join(' '),
        actorUserId: typeof event.actorUserId === 'string' ? event.actorUserId : null,
        updatedAt: event.updatedAt as string, changedFields: fields,
        priorityId: ticket.priority_id ?? null,
        categoryIds: [ticket.category_id, ticket.subcategory_id].filter((id): id is string => typeof id === 'string'),
        clientId: ticket.client_id ?? null, contactId: ticket.contact_name_id ?? null,
        ticketTagIdsByText: Object.fromEntries(tagRows.map((tag: { tag_text: string; tag_id: string }) => [tag.tag_text, tag.tag_id])),
        tags, teamIds, dueDate: ticket.due_date ?? null,
        responseState: ticket.response_state ?? 'none',
        slaStatus,
        isBoardActive: !board || !board.is_inactive,
        statusIsClosed: Boolean(status?.is_closed),
        masterTicketId: ticket.master_ticket_id ?? null,
        filterRecord,
      };
    });
    return change ? NextResponse.json({ change }, { headers: { 'Cache-Control': 'no-store, private' } }) : NextResponse.json({ change: null }, { status: 404 });
  } catch (error) {
    if (isTicketReadDenied(error)) {
      return NextResponse.json({ change: null }, { status: 404 });
    }
    console.error('[ticket-live-change] Failed to authorize or enrich change', error);
    return NextResponse.json({ error: 'Unable to authorize ticket change' }, { status: 503 });
  }
}
