'use server'

import { getSystemEmailService, TenantEmailService } from './index';
import { DatabaseTemplateProcessor } from './templateProcessors';
import { getConnection, runWithTenant } from '@alga-psa/db';
import { resolveEmailLocale } from './emailLocaleResolver';
import { SupportedLocale } from './lib/localeConfig';
import logger from '@alga-psa/core/logger';

interface SendTeamInvitationEmailParams {
  email: string;
  teamMemberName: string;
  tenantName: string;
  roleName: string;
  invitedByName: string;
  inviteLink: string;
  expirationTime: string;
  tenant: string;
}

export async function sendTeamInvitationEmail({
  email,
  teamMemberName,
  tenantName,
  roleName,
  invitedByName,
  inviteLink,
  expirationTime,
  tenant
}: SendTeamInvitationEmailParams): Promise<boolean> {
  try {
    return await runWithTenant(tenant, async () => {
      const knex = await getConnection(tenant);

      // The invitee doesn't have a users row yet, so resolve locale using the
      // tenant/organization default for internal users (no userId/clientId).
      const recipientLocale: SupportedLocale = await resolveEmailLocale(tenant, {
        email,
        userType: 'internal'
      });

      const templateData = {
        teamMemberName,
        tenantName,
        roleName,
        invitedByName,
        inviteLink,
        expirationTime,
        currentYear: new Date().getFullYear()
      };

      const templateProcessor = new DatabaseTemplateProcessor(knex, 'team-invitation');

      const tenantEmailService = TenantEmailService.getInstance(tenant);
      const emailParams = {
        to: email,
        templateProcessor,
        templateData,
        locale: recipientLocale
      };

      let result = await tenantEmailService.sendEmail({
        ...emailParams,
        tenantId: tenant
      });

      if (!result.success) {
        logger.warn('[SendTeamInvitationEmail] Tenant email provider failed, falling back to system provider', {
          tenant,
          error: result.error || 'unknown_error'
        });
        const systemEmailService = await getSystemEmailService();
        result = await systemEmailService.sendEmail({
          ...emailParams,
          tenantId: tenant
        });
      }

      if (!result.success) {
        logger.error('Failed to send team invitation email:', result.error);
        // Throw error to trigger transaction rollback
        throw new Error(result.error || 'Failed to send team invitation email');
      }

      return result.success;
    });
  } catch (error) {
    logger.error('Error sending team invitation email:', error);
    // Re-throw the error to ensure transaction rollback
    throw error;
  }
}
