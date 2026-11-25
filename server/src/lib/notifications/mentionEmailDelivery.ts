import type { Knex } from 'knex';
import type { OutboundMailClass } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { sendEventEmail, resolveEventEmailLocale } from './sendEventEmail';
import { resolveEmailNotificationPreference } from './emailNotificationPreferences';

export const USER_MENTION_SUBTYPE = 'user-mentioned';
export const USER_MENTION_TEMPLATE = 'user-mentioned';

export interface MentionEmailContext {
  authorName: string;
  entityType: string;
  entityName: string;
  commentPreview?: string;
  url: string;
  mailClass: OutboundMailClass;
  entityId?: string;
  boardId?: string;
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
    const isDocument = input.entityType === 'document';
    const ticketNumber = isTicket
      ? input.entityName.replace(/^#/, '')
      : '';
    const recipientLocale = await resolveEventEmailLocale({
      tenantId,
      to: user.email,
      recipientUserId: userId,
    });
    const { t } = await getServerTranslation(recipientLocale, 'common');
    const interpolation = {
      authorName: input.authorName,
      taskName: isTask ? input.entityName : '',
      ticketNumber,
      documentName: isDocument ? input.entityName : '',
    };
    const introKey = isTask
      ? 'notifications.mentions.taskIntro'
      : isTicket
        ? 'notifications.mentions.ticketIntro'
        : 'notifications.mentions.documentIntro';
    const textIntroKey = isTask
      ? 'notifications.mentions.textTaskIntro'
      : isTicket
        ? 'notifications.mentions.textTicketIntro'
        : 'notifications.mentions.textDocumentIntro';

    await sendEventEmail({
      mailClass: input.mailClass,
      boardId: input.boardId,
      tenantId,
      to: user.email,
      locale: recipientLocale,
      subject: t('notifications.mentions.subject', interpolation),
      template: USER_MENTION_TEMPLATE,
      context: {
        authorName: input.authorName,
        entityType: input.entityType,
        entityName: input.entityName,
        commentPreview: input.commentPreview ?? '',
        url: input.url,
        mentionSubject: t('notifications.mentions.subject', interpolation),
        mentionHeaderLabel: t('notifications.mentions.headerLabel'),
        mentionIntro: t(introKey, interpolation),
        mentionClosingNote: t('notifications.mentions.closingNote'),
        mentionViewButton: t('notifications.mentions.viewButton'),
        mentionFooter: t('notifications.mentions.footer'),
        mentionTextIntro: t(textIntroKey, interpolation),
        mentionTextClosingNote: t('notifications.mentions.textClosingNote'),
        mentionTextView: t('notifications.mentions.textView'),
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
