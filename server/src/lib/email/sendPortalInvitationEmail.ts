'use server'

import { getSystemEmailService } from './index';
import { DatabaseTemplateProcessor } from '../services/email/templateProcessors';
import { getConnection } from '../db/db';
import { runWithTenant } from '../db/index';
import { getUserInfoForEmail, resolveEmailLocale } from '../notifications/emailLocaleResolver';
import { SupportedLocale } from '../i18n/config';
import logger from '@alga-psa/shared/core/logger';

interface SendPortalInvitationEmailParams {
  email: string;
  contactName: string;
  clientName: string;
  portalLink: string;
  expirationTime: string;
  tenant: string;
  clientLocationEmail?: string;
  clientLocationPhone?: string;
  fromName?: string;
  recipientUserId?: string;
  clientId?: string;  // Client ID (from contact.company_id) for locale resolution when user doesn't exist yet
}

export async function sendPortalInvitationEmail({
  email,
  contactName,
  clientName,
  portalLink,
  expirationTime,
  tenant,
  clientLocationEmail,
  clientLocationPhone,
  fromName: _fromName,
  recipientUserId,
  clientId
}: SendPortalInvitationEmailParams): Promise<boolean> {
  try {
    return await runWithTenant(tenant, async () => {
      const knex = await getConnection(tenant);

      // Resolve recipient locale for language-aware email
      let recipientLocale: SupportedLocale;

      // Get recipient information for locale resolution
      // For portal invitations, we need to include clientId for contacts who don't have user accounts yet
      const recipientInfo = recipientUserId
        ? { email, userId: recipientUserId }
        : await getUserInfoForEmail(tenant, email) ?? { email, clientId };

      logger.info('[SendPortalInvitationEmail] Recipient info:', recipientInfo);

      // Portal invitations are ALWAYS for client users (contacts), never internal users
      // So we should always do full locale resolution with client/tenant hierarchy
      recipientLocale = await resolveEmailLocale(tenant, recipientInfo);
      logger.info('[SendPortalInvitationEmail] Resolved locale:', {
        locale: recipientLocale,
        email,
        userId: recipientInfo.userId,
        clientId: recipientInfo.clientId
      });

      // Prepare template data
      const templateData = {
        contactName,
        clientName,
        portalLink,
        expirationTime,
        currentYear: new Date().getFullYear(),
        clientLocationEmail: clientLocationEmail || 'Not provided',
        clientLocationPhone: clientLocationPhone || 'Not provided'
      };

      // Create database template processor with locale support
      const templateProcessor = new DatabaseTemplateProcessor(knex, 'portal-invitation');

      // Use SystemEmailService for better deliverability
      const systemEmailService = await getSystemEmailService();
      const result = await systemEmailService.sendEmail({
        to: email,
        templateProcessor,
        templateData,
        locale: recipientLocale,
        replyTo: clientLocationEmail // Client email as reply-to
      });

      if (!result.success) {
        logger.error('Failed to send portal invitation email:', result.error);
        // Throw error to trigger transaction rollback
        throw new Error(result.error || 'Failed to send portal invitation email');
      }

      return result.success;
    });
  } catch (error) {
    logger.error('Error sending portal invitation email:', error);
    // Re-throw the error to ensure transaction rollback
    throw error;
  }
}
