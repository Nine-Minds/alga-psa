'use server'

import { getSystemEmailService } from './index';
import { DatabaseTemplateProcessor } from '../services/email/templateProcessors';
import { getConnection } from '../db/db';
import { runWithTenant } from '../db/index';
import logger from '@alga-psa/shared/core/logger';

interface SendPortalInvitationEmailParams {
  email: string;
  contactName: string;
  companyName: string;
  portalLink: string;
  expirationTime: string;
  tenant: string;
  companyLocationEmail?: string;
  companyLocationPhone?: string;
  fromName?: string;
}

export async function sendPortalInvitationEmail({ 
  email, 
  contactName,
  companyName,
  portalLink,
  expirationTime,
  tenant,
  companyLocationEmail,
  companyLocationPhone,
  fromName: _fromName
}: SendPortalInvitationEmailParams): Promise<boolean> {
  try {
    return await runWithTenant(tenant, async () => {
      const knex = await getConnection(tenant);
      
      // Prepare template data
      const templateData = {
        contactName,
        companyName,
        portalLink,
        expirationTime,
        currentYear: new Date().getFullYear(),
        companyLocationEmail: companyLocationEmail || 'Not provided',
        companyLocationPhone: companyLocationPhone || 'Not provided'
      };

      // Create database template processor to get the template from tenant DB
      const templateProcessor = new DatabaseTemplateProcessor(knex, 'portal-invitation');

      // Use SystemEmailService temporarily until domain approval is implemented
      // This ensures better deliverability using the platform's authenticated domain
      const systemEmailService = await getSystemEmailService();
      const result = await systemEmailService.sendEmail({
        to: email,
        templateProcessor,
        templateData,
        replyTo: companyLocationEmail // Company email as reply-to
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
