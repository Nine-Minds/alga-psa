import type { Knex } from 'knex';
import type { OutboundMailClass } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { sendEventEmail, resolveEventEmailLocale } from './sendEventEmail';
import { resolveEmailNotificationPreference } from './emailNotificationPreferences';
import {
  recipientRendering,
  resolveTicketNotificationRecipient,
  selectAudienceContent,
  type AudienceSource,
} from '@alga-psa/shared/lib/notificationAudience';

export const USER_MENTION_SUBTYPE = 'user-mentioned';
export const USER_MENTION_TEMPLATE = 'user-mentioned';

export interface MentionEmailContext {
  authorName: string;
  entityType: string;
  entityName: string;
  /** Ticket title for a ticket, project name for a task; omitted for documents. */
  contextName?: string;
  commentPreview?: string;
  url: string;
  mailClass: OutboundMailClass;
  entityId?: string;
  boardId?: string;
  /** The ticket and comment audience a ticket mention quotes. Omitted for task and document mentions. */
  ticketAudience?: { ticketId: string; audience: AudienceSource };
}

/**
 * Sends the existing @-mention email template after the in-app mention action
 * has been created. Email preference and recipient checks stay aligned with
 * the notification settings UI and other event-email subscribers.
 */
export async function deliverUserMentionEmail(
  knex: Knex,
  tenantId: string,
  userId: string,
  input: MentionEmailContext,
): Promise<boolean> {
  try {
    // Same recipient boundary as the in-app mention: a seat technician is mailed only about an
    // in-scope ticket whose comment audience admits them, and never for task or document mentions.
    const recipient = await resolveTicketNotificationRecipient(
      knex, tenantId, { ticketId: input.ticketAudience?.ticketId }, { userId });
    const admission = await selectAudienceContent(
      recipient, input.ticketAudience ? [{ audience: input.ticketAudience.audience }] : undefined);
    if (!admission.admitted || recipientRendering(recipient, 'msp') !== 'msp') return false;

    const preference = await resolveEmailNotificationPreference(
      knex,
      tenantId,
      USER_MENTION_SUBTYPE,
      userId,
    );
    if (!preference.enabled || !preference.subtypeId) return false;

    const db = tenantDb(knex, tenantId);
    const user = await db.table('users').where({ user_id: userId }).first('email');
    if (!user?.email) return false;

    const isTask = input.entityType === 'task comment' || input.entityType === 'project_task';
    const isTicket = input.entityType === 'ticket';
    const recipientLocale = await resolveEventEmailLocale({
      tenantId,
      to: user.email,
      recipientUserId: userId,
    });

    await sendEventEmail({
      mailClass: input.mailClass,
      boardId: input.boardId,
      tenantId,
      to: user.email,
      locale: recipientLocale,
      // Fallback only: the stored template's localized subject takes precedence.
      subject: `${input.authorName} mentioned you in ${input.entityName}`,
      template: USER_MENTION_TEMPLATE,
      context: {
        mention: {
          author: input.authorName,
          entityName: input.entityName,
          contextName: input.contextName ?? '',
          isTicket,
          isTask,
          isDocument: input.entityType === 'document',
          commentPreview: input.commentPreview ?? '',
          url: input.url,
        },
      },
      entityType: input.entityType,
      entityId: input.entityId,
      recipientUserId: userId,
      notificationSubtypeId: preference.subtypeId,
    });
    return true;
  } catch (error) {
    logger.warn('[MentionEmailDelivery] Email notification failed', {
      tenantId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
