import { getAdminConnection } from '../../db/admin';
import { tenantDb } from '@alga-psa/db';
import logger from '../../core/logger';

export type MicrosoftEmailFailureCategory =
  | 'authorization_missing'
  | 'oauth_unauthorized'
  | 'oauth_bad_request'
  | 'tenant_configuration'
  | 'webhook_configuration'
  | 'maintenance_failure';

export function classifyMicrosoftEmailFailure(message: string | null): MicrosoftEmailFailureCategory {
  const normalized = (message || '').toLowerCase();

  if (normalized.includes('tokens not found') || normalized.includes('complete authorization')) {
    return 'authorization_missing';
  }
  if (
    normalized.includes('status code 401') ||
    normalized.includes('invalid_grant') ||
    normalized.includes('re-authorize') ||
    normalized.includes('authorization appears invalid')
  ) {
    return 'oauth_unauthorized';
  }
  if (normalized.includes('status code 400')) {
    return 'oauth_bad_request';
  }
  if (normalized.includes('concrete microsoft tenant id')) {
    return 'tenant_configuration';
  }
  if (normalized.includes('webhook') && normalized.includes('url')) {
    return 'webhook_configuration';
  }
  return 'maintenance_failure';
}

/**
 * Update email_providers connection status and emit logfmt transition events
 * (event=microsoft_email_provider_unhealthy / _recovered) that log-based
 * alerting watches. Events fire only on status transitions, so callers may
 * invoke this on every observation without spamming the log stream. A
 * no-change healthy observation skips the write entirely, keeping the
 * success path to a single indexed read.
 */
export async function setEmailProviderConnectionStatus(params: {
  providerId: string;
  tenant: string;
  status: 'connected' | 'error';
  errorMessage: string | null;
}): Promise<void> {
  const { providerId, tenant, status, errorMessage } = params;
  const knex = await getAdminConnection();
  const scopedDb = tenantDb(knex, tenant);
  const previous = await scopedDb.table('email_providers')
    .where({ id: providerId })
    .first('status', 'error_message');

  if (
    status === 'connected' &&
    previous?.status === 'connected' &&
    previous?.error_message == null
  ) {
    return;
  }

  await scopedDb.table('email_providers')
    .where({ id: providerId })
    .update({
      status,
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    });

  if (previous?.status === status) return;

  if (status === 'error') {
    const failureCategory = classifyMicrosoftEmailFailure(errorMessage);
    logger.error(
      `event=microsoft_email_provider_unhealthy provider_id=${providerId} failure_category=${failureCategory}`
    );
    return;
  }

  logger.info(`event=microsoft_email_provider_recovered provider_id=${providerId}`);
}
