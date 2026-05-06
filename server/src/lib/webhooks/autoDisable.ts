import logger from '@alga-psa/core/logger';
import { getSystemEmailService } from '@alga-psa/email';

import { getConnection } from '@/lib/db/db';

import { WebhookRecord } from './webhookModel';
import { emitWebhookMetric } from './metrics';

const AUTO_DISABLE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function maybeAutoDisable(webhook: WebhookRecord): Promise<void> {
  if (!webhook.isActive || webhook.autoDisabledAt) {
    return;
  }

  const knex = await getConnection(webhook.tenant);
  const firstFailureSinceLastSuccess = await knex('webhook_deliveries')
    .where({
      tenant: webhook.tenant,
      webhook_id: webhook.webhookId,
    })
    .modify((query) => {
      if (webhook.lastSuccessAt) {
        query.andWhere('attempted_at', '>', webhook.lastSuccessAt);
      }
    })
    .whereNot('status', 'delivered')
    .orderBy('attempted_at', 'asc')
    .select('attempted_at')
    .first<{ attempted_at: Date | string | null }>();

  if (!firstFailureSinceLastSuccess?.attempted_at) {
    return;
  }

  const firstFailureAt = new Date(firstFailureSinceLastSuccess.attempted_at);
  if (Number.isNaN(firstFailureAt.getTime())) {
    return;
  }

  if (Date.now() - firstFailureAt.getTime() < AUTO_DISABLE_WINDOW_MS) {
    return;
  }

  const autoDisabledAt = new Date();
  const [updated] = await knex('webhooks')
    .where({
      tenant: webhook.tenant,
      webhook_id: webhook.webhookId,
      is_active: true,
    })
    .update({
      is_active: false,
      auto_disabled_at: autoDisabledAt,
      updated_at: knex.fn.now(),
    })
    .returning([
      'webhook_id',
      'tenant',
      'name',
      'created_by_user_id',
    ]);

  if (!updated) {
    return;
  }

  emitWebhookMetric('webhook_auto_disabled_total', {
    tenant: updated.tenant,
    webhook_id: updated.webhook_id,
  }, 'warn');

  await notifyWebhookOwner({
    webhookId: updated.webhook_id,
    tenantId: updated.tenant,
    webhookName: updated.name,
    userId: updated.created_by_user_id,
    autoDisabledAt,
  });
}

async function notifyWebhookOwner(input: {
  webhookId: string;
  tenantId: string;
  webhookName: string;
  userId: string;
  autoDisabledAt: Date;
}): Promise<void> {
  const knex = await getConnection(input.tenantId);
  const user = await knex('users')
    .select('user_id', 'email', 'first_name', 'last_name')
    .where({
      tenant: input.tenantId,
      user_id: input.userId,
    })
    .first<{
      user_id: string;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    }>();

  if (!user?.email) {
    logger.warn('[WebhookAutoDisable] Skipping owner notification, user email missing', {
      tenantId: input.tenantId,
      webhookId: input.webhookId,
      userId: input.userId,
    });
    return;
  }

  const ownerName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || 'there';
  const subject = `Webhook "${input.webhookName}" was disabled after repeated delivery failures`;
  const text = [
    `Hi ${ownerName},`,
    '',
    `The webhook "${input.webhookName}" (${input.webhookId}) was automatically disabled after 24 hours of continuous delivery failures.`,
    `Disabled at: ${input.autoDisabledAt.toISOString()}`,
    '',
    'Review the endpoint configuration and reactivate the webhook once the target is healthy again.',
  ].join('\n');
  const html = [
    `<p>Hi ${escapeHtml(ownerName)},</p>`,
    `<p>The webhook <strong>${escapeHtml(input.webhookName)}</strong> (${escapeHtml(input.webhookId)}) was automatically disabled after 24 hours of continuous delivery failures.</p>`,
    `<p>Disabled at: <code>${escapeHtml(input.autoDisabledAt.toISOString())}</code></p>`,
    '<p>Review the endpoint configuration and reactivate the webhook once the target is healthy again.</p>',
  ].join('');

  try {
    const emailService = await getSystemEmailService();
    await emailService.sendEmail({
      to: user.email,
      subject,
      text,
      html,
      tenantId: input.tenantId,
      userId: user.user_id,
    });
  } catch (error) {
    logger.error('[WebhookAutoDisable] Failed to notify webhook owner', {
      tenantId: input.tenantId,
      webhookId: input.webhookId,
      userId: input.userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
