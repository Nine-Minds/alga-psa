'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { EmailProviderService } from '../../services/email/EmailProviderService';

export interface EmailProviderPauseActionResult {
  success: boolean;
  error?: string;
  resumed?: boolean;
  webhookRegistered?: boolean;
}

async function canConfigureEmailProviders(user: any, knex: any): Promise<boolean> {
  return hasPermission(user, 'ticket_settings', 'update', knex);
}

export const pauseEmailProvider = withAuth(async (
  user,
  { tenant },
  providerId: string
): Promise<EmailProviderPauseActionResult> => {
  const { knex } = await createTenantKnex();
  if (!(await canConfigureEmailProviders(user, knex))) {
    return { success: false, error: 'Permission denied' };
  }

  const provider = await tenantDb(knex, tenant)
    .table('email_providers')
    .where({ id: providerId })
    .first('id');
  if (!provider) {
    return { success: false, error: 'Email provider not found' };
  }

  try {
    await new EmailProviderService().pauseProvider(providerId, tenant, 'manual');
    return { success: true };
  } catch (error) {
    console.error('Failed to pause email provider:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to pause email provider',
    };
  }
});

export const resumeEmailProvider = withAuth(async (
  user,
  { tenant },
  providerId: string
): Promise<EmailProviderPauseActionResult> => {
  const { knex } = await createTenantKnex();
  if (!(await canConfigureEmailProviders(user, knex))) {
    return { success: false, error: 'Permission denied' };
  }

  const provider = await tenantDb(knex, tenant)
    .table('email_providers')
    .where({ id: providerId })
    .first('id');
  if (!provider) {
    return { success: false, error: 'Email provider not found' };
  }

  try {
    const result = await new EmailProviderService().resumeProvider(providerId, tenant);
    return {
      success: !result.error,
      error: result.error,
      resumed: result.resumed,
      webhookRegistered: result.webhookRegistered,
    };
  } catch (error) {
    console.error('Failed to resume email provider:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resume email provider',
    };
  }
});
