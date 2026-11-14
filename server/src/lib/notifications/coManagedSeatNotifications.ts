/**
 * Co-managed seat notifications (in-app): a ticket handed to client IT or to the MSP, and a shared
 * IT note.
 *
 * Who is told is decided by `@alga-psa/co-managed` (`seatNotifications`), from stored state, and
 * only for a tenant the seat gate serves and a client with a live seat arrangement; for everyone
 * else these functions create nothing. This module only delivers: one notification per recipient,
 * claimed in the co-managed delivery ledger in the transaction that creates it, so delivering the
 * same handoff or comment again creates nothing.
 */
import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import {
  registerCoManagedSeatHandoffListener, resolveCoManagedSeatHandoffNotice, resolveCoManagedSeatSharedNoteRecipients,
} from '@alga-psa/co-managed';
import { createNotificationFromTemplateInternal } from '@alga-psa/notifications/actions';
import { CO_MANAGED_LEDGER } from '@shared/lib/deliveryLedger';
import { getConnection } from '../db/db';
import { resolveNotificationLinks } from '../utils/notificationLinkResolver';
import { filterRecipientsWhoCanReadTicket } from './boardNotificationAudience';

const HANDOFF_DELIVERY_KIND = 'seat_handoff_in_app';
const SHARED_NOTE_DELIVERY_KIND = 'seat_shared_note_in_app';

const displayName = (user: { first_name?: string | null; last_name?: string | null } | undefined, fallback: string): string =>
  `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() || fallback;

/**
 * Tells the receiving organization about one recorded handoff. Returns the users a notification
 * was created for on THIS call (none on a repeat, and none a recipient's preferences mute).
 */
export async function deliverCoManagedSeatHandoffNotifications(
  db: Knex,
  input: { tenantId: string; operationId: string },
): Promise<string[]> {
  const notice = await resolveCoManagedSeatHandoffNotice(db, { sponsorTenant: input.tenantId, operationId: input.operationId });
  if (!notice || notice.recipients.length === 0) return [];
  const { tenant, ticketId } = notice;

  // Board-rule recipients are told about a ticket they were never put on, so the existing rule
  // applies: only those who can open it. Assignment recipients are on the ticket already.
  const byBoardRule = new Set(notice.boardRuleRecipients);
  const readable = byBoardRule.size === 0 ? byBoardRule : new Set((await filterRecipientsWhoCanReadTicket(db, tenant, ticketId,
    notice.boardRuleRecipients.map((userId) => ({ userId, email: '', displayName: '' })))).map((recipient) => recipient.userId));
  const recipients = notice.recipients.filter((userId) => !byBoardRule.has(userId) || readable.has(userId));
  if (recipients.length === 0) return [];

  const scoped = tenantDb(db, tenant);
  const [ticket, actor] = await Promise.all([
    scoped.table('tickets').where('ticket_id', ticketId).first('ticket_number', 'title'),
    scoped.table('users').where('user_id', notice.actorUserId).first('first_name', 'last_name'),
  ]);
  if (!ticket) return [];
  const { internalUrl } = await resolveNotificationLinks(db, tenant, { type: 'ticket', ticketId, ticketNumber: ticket.ticket_number });

  const toClientIt = notice.to === 'client_it';
  const notified: string[] = [];
  for (const userId of recipients) {
    const created = await createNotificationFromTemplateInternal(db, {
      tenant,
      user_id: userId,
      template_name: toClientIt ? 'ticket-handed-to-client-it' : 'ticket-handed-to-msp',
      type: 'info',
      category: 'tickets',
      link: internalUrl,
      // A handoff is a ticket-level fact: everyone admitted to the ticket may be told it.
      ticketAudience: { ticketId, audience: 'requester' },
      data: {
        ticketId: ticket.ticket_number,
        ticketNumber: ticket.ticket_number,
        ticketTitle: ticket.title,
        performedByName: displayName(actor, 'Someone'),
      },
      metadata: { ticketId, handoff: { operationId: notice.operationId, to: notice.to } },
    }, { delivery: { ledger: CO_MANAGED_LEDGER,
      key: { delivery_kind: HANDOFF_DELIVERY_KIND, source_id: notice.operationId, recipient: userId },
      extra: { recipient_kind: toClientIt ? 'customer_user' : 'msp_user' } } });
    if (created) notified.push(userId);
  }
  logger.info('[CoManagedSeatNotifications] Delivered handoff notifications', {
    tenantId: tenant, ticketId, operationId: notice.operationId, to: notice.to, recipientCount: notified.length,
  });
  return notified;
}

/**
 * Tells the other organization's participants about one shared IT note, through the standard
 * comment notification. `alreadyNotified` (e.g. users the comment mentions) are skipped. Returns
 * the users a notification was created for on this call.
 */
export async function deliverCoManagedSeatSharedNoteNotifications(
  db: Knex,
  input: {
    tenantId: string; ticketId: string; commentId: string; authorUserId: string | null | undefined;
    ticketNumber: string | null; authorName: string; commentPreview: string; link: string | undefined;
    alreadyNotified?: ReadonlySet<string>;
  },
): Promise<string[]> {
  const recipients = await resolveCoManagedSeatSharedNoteRecipients(db, {
    tenant: input.tenantId, ticketId: input.ticketId, commentId: input.commentId, authorUserId: input.authorUserId });
  const notified: string[] = [];
  for (const userId of recipients) {
    if (input.alreadyNotified?.has(userId)) continue;
    const created = await createNotificationFromTemplateInternal(db, {
      tenant: input.tenantId,
      user_id: userId,
      template_name: 'ticket-comment-added',
      type: 'info',
      category: 'tickets',
      link: input.link,
      // The note is shared IT: a seat technician is told it only while the ticket is in their scope.
      ticketAudience: { ticketId: input.ticketId, audience: 'shared_it' },
      data: { authorName: input.authorName, ticketId: input.ticketNumber || 'New Ticket', commentPreview: input.commentPreview },
      metadata: {
        ticketId: input.ticketId,
        ticketNumber: input.ticketNumber || 'New Ticket',
        comment: { id: input.commentId, text: input.commentPreview, author: input.authorName,
          ...(input.authorUserId ? { authorId: input.authorUserId } : {}), isInternal: true, audience: 'shared_it' },
      },
    }, { delivery: { ledger: CO_MANAGED_LEDGER,
      key: { delivery_kind: SHARED_NOTE_DELIVERY_KIND, source_id: input.commentId, recipient: userId },
      // Both organizations are users of this tenant; the ledger's recipient kinds name no finer distinction.
      extra: { recipient_kind: 'msp_user' } } });
    if (created) notified.push(userId);
  }
  if (notified.length > 0) {
    logger.info('[CoManagedSeatNotifications] Delivered shared IT note notifications', {
      tenantId: input.tenantId, ticketId: input.ticketId, commentId: input.commentId, recipientCount: notified.length,
    });
  }
  return notified;
}

const LISTENER = 'in-app-notifications';
let unregister: (() => void) | null = null;

/**
 * Delivery runs in the background after the handoff commits: the command does not wait for it and
 * a delivery failure never reaches the person handing the ticket off.
 */
export async function registerCoManagedSeatHandoffNotifications(): Promise<void> {
  unregister = registerCoManagedSeatHandoffListener(LISTENER, (receipt) => {
    void (async () => {
      const db = await getConnection(receipt.sponsorTenant);
      await deliverCoManagedSeatHandoffNotifications(db, { tenantId: receipt.sponsorTenant, operationId: receipt.operationId });
    })().catch((error) => {
      logger.error('[CoManagedSeatNotifications] Handoff notification delivery failed', {
        tenantId: receipt.sponsorTenant, operationId: receipt.operationId, error,
      });
    });
  });
}

export async function unregisterCoManagedSeatHandoffNotifications(): Promise<void> {
  unregister?.();
  unregister = null;
}
