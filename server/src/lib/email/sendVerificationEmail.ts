'use server'

import { createTenantKnex, runWithTenant } from 'server/src/lib/db';
import { TenantEmailService } from '../services/TenantEmailService';
import { DatabaseTemplateProcessor } from '../services/email/templateProcessors';

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
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const verificationUrl = `${baseUrl}/auth/verify?token=${token}&registrationId=${registrationId}`;

      // Get both company names from their respective tables
      const [registrationCompany, tenantCompany] = await Promise.all([
        knex('companies').where({ tenant }).select('company_name').first(),
        knex('tenants').where({ tenant }).select('company_name').first()
      ]);

      if (!registrationCompany || !tenantCompany) {
        throw new Error('Company information not found');
      }

      // Prepare template data
      const templateData = {
        email,
        verificationUrl,
        registrationCompanyName: registrationCompany.company_name,
        tenantCompanyName: tenantCompany.company_name,
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
