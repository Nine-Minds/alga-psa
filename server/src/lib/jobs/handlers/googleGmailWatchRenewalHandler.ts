import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { configureGmailProvider } from '@/lib/actions/email-actions/configureGmailProvider';

export interface GoogleGmailWatchRenewalJobData extends Record<string, unknown> {
  tenantId: string;
  lookAheadMinutes?: number;
}

export async function renewGoogleGmailWatchSubscriptions(
  data: GoogleGmailWatchRenewalJobData
): Promise<void> {
  const { tenantId, lookAheadMinutes = 360 } = data;

  const knex = await getAdminConnection();
  const threshold = new Date(Date.now() + lookAheadMinutes * 60_000);

  const providers = await knex('email_providers as ep')
    .join('google_email_provider_config as gc', function () {
      this.on('ep.id', '=', 'gc.email_provider_id').andOn('ep.tenant', '=', 'gc.tenant');
    })
    .where('ep.provider_type', 'google')
    .andWhere('ep.is_active', true)
    .andWhere('ep.tenant', tenantId)
    .andWhere(function () {
      this.whereNull('gc.watch_expiration').orWhere('gc.watch_expiration', '<=', threshold.toISOString());
    })
    .select({
      providerId: 'ep.id',
      tenant: 'ep.tenant',
      mailbox: 'ep.mailbox',
      projectId: 'gc.project_id'
    });

  if (providers.length === 0) {
    return;
  }

  const secretProvider = await getSecretProviderInstance();

  for (const p of providers) {
    try {
      const projectId =
        p.projectId ||
        (await secretProvider.getTenantSecret(p.tenant, 'google_project_id')) ||
        null;

      if (!projectId) {
        logger.warn('[GoogleGmailWatchRenewal] Missing project_id for provider, skipping', {
          tenantId: p.tenant,
          providerId: p.providerId,
          mailbox: p.mailbox
        });
        continue;
      }

      await configureGmailProvider({
        tenant: p.tenant,
        providerId: p.providerId,
        projectId,
        force: true
      });
    } catch (error: any) {
      logger.error('[GoogleGmailWatchRenewal] Failed to renew Gmail watch', {
        tenantId: p.tenant,
        providerId: p.providerId,
        mailbox: p.mailbox,
        error: error?.message || error
      });
    }
  }
}

