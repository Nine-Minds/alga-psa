'use server'

import { createTenantKnex, runWithTenant } from 'server/src/lib/db';
import { getEmailService } from 'server/src/services/emailService';

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

      // Get email service
      const emailService = await getEmailService();
      await emailService.initialize();

      // Send verification email with both company names
      const success = await emailService.sendTemplatedEmail({
        toEmail: email,
        subject: 'Verify your email address',
        templateName: 'email-verification',
        templateData: {
          email,
          verificationUrl,
          registrationCompanyName: registrationCompany.company_name,
          tenantCompanyName: tenantCompany.company_name,
          currentYear: new Date().getFullYear()
        }
      });

      if (!success) {
        throw new Error('Failed to send email');
      }

      return true;
    });
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
}
