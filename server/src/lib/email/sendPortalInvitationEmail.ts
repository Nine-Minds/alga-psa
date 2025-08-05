'use server'

import { TenantEmailService } from '../services/TenantEmailService';
import { DatabaseTemplateProcessor } from '../services/email/templateProcessors';
import { createTenantKnex, runWithTenant } from '../db';

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
  fromName
}: SendPortalInvitationEmailParams): Promise<boolean> {
  try {
    return await runWithTenant(tenant, async () => {
      const { knex } = await createTenantKnex();
      
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

      // Create database template processor
      const templateProcessor = new DatabaseTemplateProcessor(knex, 'portal-invitation');

      // Use TenantEmailService to send the email
      const result = await TenantEmailService.sendEmail({
        tenantId: tenant,
        to: email,
        templateProcessor,
        templateData,
        fromName,
        replyTo: companyLocationEmail ? { email: companyLocationEmail } : undefined
      });

      return result.success;
    });
  } catch (error) {
    console.error('Error sending portal invitation email:', error);
    // Re-throw the error to ensure transaction rollback
    throw error;
  }
}
