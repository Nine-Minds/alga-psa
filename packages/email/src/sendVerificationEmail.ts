'use server'

import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import { TenantEmailService } from './TenantEmailService';
import { DatabaseTemplateProcessor } from './templateProcessors';

interface SendVerificationEmailParams {
  email: string;
  token: string;
  registrationId: string;
  tenant: string;
}

export async function sendVerificationEmail({ 
  email, 
  token, 
  registrationId,
  tenant 
}: SendVerificationEmailParams): Promise<boolean> {
  try {
    return await runWithTenant(tenant, async () => {
      const { knex } = await createTenantKnex();

      // Get the base URL from environment variable or default to localhost
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
      const verificationUrl = `${baseUrl}/auth/verify?token=${token}&registrationId=${registrationId}`;

      // Get both client names from their respective tables
      const [registrationCompany, tenantRecord] = await Promise.all([
        knex('clients').where({ tenant }).select('client_name').first(),
        knex('tenants').where({ tenant }).select('client_name').first()
      ]);

      if (!registrationCompany || !tenantRecord) {
        throw new Error('Client information not found');
      }

      // Prepare template data
      const templateData = {
        email,
        verificationUrl,
        registrationClientName: registrationCompany.client_name,
        tenantClientName: tenantRecord.client_name,
        currentYear: new Date().getFullYear()
      };

      // Create database template processor
      const templateProcessor = new DatabaseTemplateProcessor(knex, 'email-verification');

      // Use TenantEmailService to send the email
      const result = await TenantEmailService.sendEmail({
        tenantId: tenant,
        to: email,
        templateProcessor,
        templateData
      });

      return result.success;
    });
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
}
