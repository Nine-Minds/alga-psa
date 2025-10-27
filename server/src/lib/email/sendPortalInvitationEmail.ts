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
  recipientUserId
}: SendPortalInvitationEmailParams): Promise<boolean> {
  try {
    return await runWithTenant(tenant, async () => {
      const knex = await getConnection(tenant);

      // Resolve recipient locale for language-aware email
      let recipientLocale: SupportedLocale;

      // Get recipient information for locale resolution
      const recipientInfo = recipientUserId
        ? { email, userId: recipientUserId }
        : await getUserInfoForEmail(tenant, email) ?? { email };

      // Only do full locale resolution for client portal users
      // MSP portal doesn't have i18n yet, so internal users always get English
      if (recipientInfo.userType === 'client') {
        recipientLocale = await resolveEmailLocale(tenant, recipientInfo);
        logger.debug('[SendPortalInvitationEmail] Resolved client user locale:', {
          locale: recipientLocale,
          email,
          userId: recipientInfo.userId
        });
      } else {
        // Internal users always get English (MSP portal not i18n yet)
        recipientLocale = 'en';
        logger.debug('[SendPortalInvitationEmail] Using English for internal/unknown user:', {
          locale: recipientLocale,
          email,
          userType: recipientInfo.userType
        });
      }

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
