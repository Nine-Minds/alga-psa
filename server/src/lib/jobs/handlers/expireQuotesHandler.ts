import { Knex } from 'knex';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
import logger from '@alga-psa/core/logger';
import { TenantEmailService } from '@alga-psa/email';

export interface ExpireQuotesJobData extends Record<string, unknown> {
  tenantId: string;
}

interface ExpiredQuoteNotification {
  quoteId: string;
  quoteNumber: string | null;
  title: string;
  creatorEmail: string | null;
  creatorUserId: string | null;
  validUntil: string | Date | null;
}

function formatDate(value: string | Date | null): string {
  if (!value) {
    return 'the scheduled expiration date';
  }

  return new Date(value).toLocaleDateString();
}

async function sendExpirationNotification(
  tenantId: string,
  notification: ExpiredQuoteNotification,
  tenantName: string
): Promise<void> {
  if (!notification.creatorEmail) {
    return;
  }

  const emailService = TenantEmailService.getInstance(tenantId);
  const subject = `Quote ${notification.quoteNumber || notification.title} expired`;
  const html = `
    <p>Hello,</p>
    <p>Your quote <strong>${notification.quoteNumber || notification.title}</strong> is now marked as expired.</p>
    <p>Title: ${notification.title}</p>
    <p>Valid until: ${formatDate(notification.validUntil)}</p>
    <p>You can review the quote in ${tenantName} and issue a revision if the client still needs an updated proposal.</p>
  `;
  const text = [
    'Hello,',
    '',
    `Your quote ${notification.quoteNumber || notification.title} is now marked as expired.`,
    `Title: ${notification.title}`,
    `Valid until: ${formatDate(notification.validUntil)}`,
    `You can review the quote in ${tenantName} and issue a revision if the client still needs an updated proposal.`,
  ].join('\n');

  const result = await emailService.sendEmail({
    tenantId,
    to: notification.creatorEmail,
    subject,
    html,
    text,
    userId: notification.creatorUserId ?? undefined,
    entityType: 'quote',
    entityId: notification.quoteId,
  });

  if (!result.success) {
    logger.warn('[expireQuotesHandler] Failed to send quote expiration notification', {
      tenantId,
      quoteId: notification.quoteId,
      recipient: notification.creatorEmail,
      error: result.error,
    });
  }
}

export async function expireQuotesHandler(data: ExpireQuotesJobData): Promise<void> {
  const { tenantId } = data;

  if (!tenantId) {
    throw new Error('Tenant ID is required for quote auto-expiration job');
  }

  await runWithTenant(tenantId, async () => {
    const knex = await getConnection(tenantId);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();
    const notifications: ExpiredQuoteNotification[] = [];

    const tenantRecord = await knex('tenants')
      .select('client_name')
      .where({ tenant: tenantId })
      .first<{ client_name?: string | null }>();
    const tenantName = tenantRecord?.client_name?.trim() || 'your PSA';

    await knex.transaction(async (trx: Knex.Transaction) => {
      await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenantId]);
      await trx.raw('select set_config(?, ?, true)', ['app.current_user', 'system']);

      const expirableQuotes = await trx('quotes as q')
        .leftJoin('users as u', function joinUsers() {
          this.on('q.created_by', 'u.user_id').andOn('q.tenant', 'u.tenant');
        })
        .select(
          'q.quote_id',
          'q.quote_number',
          'q.title',
          'q.valid_until',
          'q.created_by',
          'u.email as creator_email'
        )
        .where('q.tenant', tenantId)
        .where('q.is_template', false)
        .where('q.status', 'sent')
        .whereNotNull('q.valid_until')
        .where('q.valid_until', '<', todayStartIso);

      for (const quote of expirableQuotes) {
        await trx('quotes')
          .where({ tenant: tenantId, quote_id: quote.quote_id })
          .update({
            status: 'expired',
            expired_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          });

        await trx('quote_activities').insert({
          tenant: tenantId,
          quote_id: quote.quote_id,
          activity_type: 'expired',
          description: 'Quote automatically expired by scheduled job',
          performed_by: null,
          metadata: {
            previous_status: 'sent',
            triggered_by: 'scheduler',
          },
        });

        notifications.push({
          quoteId: quote.quote_id,
          quoteNumber: quote.quote_number ?? null,
          title: quote.title,
          creatorEmail: quote.creator_email ?? null,
          creatorUserId: quote.created_by ?? null,
          validUntil: quote.valid_until ?? null,
        });
      }

      logger.info('[expireQuotesHandler] Processed expired quotes', {
        tenantId,
        expiredCount: expirableQuotes.length,
      });
    });

    for (const notification of notifications) {
      try {
        await sendExpirationNotification(tenantId, notification, tenantName);
      } catch (notificationError) {
        logger.warn('[expireQuotesHandler] Quote expiration notification failed', {
          tenantId,
          quoteId: notification.quoteId,
          error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
      }
    }
  });
}
