/**
 * Formatted view of the original inbound email behind a ticket description or
 * comment.
 *
 * The body stored on the comment is the lossy BlockNote conversion; this route
 * re-renders the archived `.eml` so the reader can see the message as the
 * sender wrote it. Nothing is mutated and nothing new is stored.
 *
 * `404` means "no formatted view exists" — either the ticket/comment carries no
 * inbound-email identity or no archived artifact was ever written — and the UI
 * hides its toggle on that answer. Authorization reuses the same per-record
 * policy (MSP) and portal visibility filter (client portal) as the reads that
 * render the ticket itself, so this endpoint can never widen them.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import type { IUserWithRoles } from '@alga-psa/types';
import { authorizeTicketRecordAccess } from '@alga-psa/tickets/lib/ticketRecordAuthorization';
import { applyTicketVisibilityFilter } from '@alga-psa/tickets/lib/clientPortalVisibility';
import { getClientContactVisibilityContext } from '@alga-psa/tickets/lib/clientPortalVisibility.server';
import { isUuidShaped } from '@alga-psa/validation';
import { renderInboundEmailHtml } from '@shared/services/email/renderInboundEmailHtml';

type Conn = Knex | Knex.Transaction;

type ResolvedEmailSource =
  | { ok: true; messageId: string; providerId: string }
  | { ok: false; status: 403 | 404 };

const NOT_FOUND: ResolvedEmailSource = { ok: false, status: 404 };
const FORBIDDEN: ResolvedEmailSource = { ok: false, status: 403 };

/** The errors `authorizeTicketRecordAccess` throws for a denial. */
function deniedStatus(error: unknown): 403 | 404 | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'Ticket not found') return 404;
  if (error.message.startsWith('Permission denied')) return 403;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Inbound identity of a stored body. Comments nest it under `metadata.email`
 * (older rows put the message id directly on `metadata`); ticket descriptions
 * carry the same shape in `tickets.email_metadata`.
 */
function resolveEmailIdentity(raw: unknown): ResolvedEmailSource {
  const metadata = asRecord(raw);
  if (!metadata) return NOT_FOUND;
  const email = asRecord(metadata.email) ?? metadata;

  const messageId = readString(email.messageId) ?? readString(metadata.messageId);
  const providerId =
    readString(email.providerId) ?? readString(email.provider_id) ?? readString(metadata.providerId);

  return messageId && providerId ? { ok: true, messageId, providerId } : NOT_FOUND;
}

async function readTicketEmailIdentity(
  trx: Conn,
  tenant: string,
  ticketId: string
): Promise<ResolvedEmailSource> {
  const ticket = await tenantDb(trx, tenant)
    .table('tickets')
    .where({ ticket_id: ticketId })
    .first('email_metadata');
  return ticket ? resolveEmailIdentity(ticket.email_metadata) : NOT_FOUND;
}

async function readCommentEmailIdentity(
  trx: Conn,
  tenant: string,
  ticketId: string,
  commentId: string,
  /** Portal readers see only published, non-internal comments on non-internal threads. */
  portalVisibleOnly: boolean
): Promise<ResolvedEmailSource> {
  const scoped = tenantDb(trx, tenant);
  const query = scoped
    .table('comments as c')
    .where({ 'c.ticket_id': ticketId, 'c.comment_id': commentId });

  if (portalVisibleOnly) {
    scoped.tenantJoin(query, 'comment_threads as ct', 'c.thread_id', 'ct.thread_id', { type: 'left' });
    query
      .where({ 'c.is_internal': false, 'c.publish_state': 'published' })
      .where(function (this: Knex.QueryBuilder) {
        this.whereNull('ct.is_internal').orWhere('ct.is_internal', false);
      });
  }

  const comment = await query.first('c.metadata');
  if (!comment) {
    // A hidden comment must not be distinguishable from a missing one.
    return portalVisibleOnly ? FORBIDDEN : NOT_FOUND;
  }
  return resolveEmailIdentity(comment.metadata);
}

/** MSP: RBAC plus the per-record ticket policy every ticket sub-resource uses. */
async function resolveForInternalUser(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  ticketId: string,
  commentId: string | null
): Promise<ResolvedEmailSource> {
  if (!(await hasPermission(user, 'ticket', 'read', trx))) {
    return FORBIDDEN;
  }

  try {
    await authorizeTicketRecordAccess({ trx, tenant, user, ticketId, action: 'read' });
  } catch (error) {
    const status = deniedStatus(error);
    if (!status) throw error;
    return { ok: false, status };
  }

  return commentId
    ? readCommentEmailIdentity(trx, tenant, ticketId, commentId, false)
    : readTicketEmailIdentity(trx, tenant, ticketId);
}

/** Client portal: the same client/board/contact scope the portal ticket read applies. */
async function resolveForPortalUser(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  ticketId: string,
  commentId: string | null
): Promise<ResolvedEmailSource> {
  if (!(await hasPermission(user, 'ticket', 'read', trx))) {
    return FORBIDDEN;
  }
  if (!user.contact_id) {
    return FORBIDDEN;
  }

  const visibility = await getClientContactVisibilityContext(trx, tenant, user.contact_id);
  const scoped = tenantDb(trx, tenant);
  const ticket = await scoped
    .table('tickets as t')
    .where({ 't.ticket_id': ticketId, 't.client_id': visibility.clientId })
    .modify((query: Knex.QueryBuilder) => {
      applyTicketVisibilityFilter(query, visibility, {
        boardColumn: 't.board_id',
        contactColumn: 't.contact_name_id',
        billingProfileColumn: 't.billing_profile_id',
        watchListColumn: 't.attributes',
        sharedWorkspaceTickets: {
          ticketIdColumn: 't.ticket_id',
          tenantColumn: 't.tenant',
          closedColumn: 't.is_closed',
        },
      });
    })
    .first('t.email_metadata');

  if (!ticket) {
    return FORBIDDEN;
  }

  return commentId
    ? readCommentEmailIdentity(trx, tenant, ticketId, commentId, true)
    : resolveEmailIdentity(ticket.email_metadata);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params;
    const commentId = request.nextUrl.searchParams.get('commentId');

    // A malformed id gets the same answer as a ticket the reader cannot see.
    if (!isUuidShaped(ticketId) || (commentId !== null && !isUuidShaped(commentId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const user = await getCurrentUser();
    if (!user?.tenant) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tenant = user.tenant;

    const { knex } = await createTenantKnex();
    const resolved = await withTransaction(knex, (trx: Knex.Transaction) =>
      user.user_type === 'client'
        ? resolveForPortalUser(trx, tenant, user, ticketId, commentId)
        : resolveForInternalUser(trx, tenant, user, ticketId, commentId)
    );

    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.status === 403 ? 'Forbidden' : 'Not found' },
        { status: resolved.status }
      );
    }

    const html = await renderInboundEmailHtml({
      db: knex,
      tenantId: tenant,
      providerId: resolved.providerId,
      messageId: resolved.messageId,
    });

    if (!html) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ html }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[ticket email-html] Failed to render original email:', error);
    return NextResponse.json({ error: 'Failed to render original email' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
