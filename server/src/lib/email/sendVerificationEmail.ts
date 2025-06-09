'use server'

import { createTenantKnex, runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
import { EmailProviderManager } from 'server/src/services/email/EmailProviderManager';
import { TenantEmailSettings, EmailMessage } from 'server/src/types/email.types';

interface SendVerificationEmailParams {
  email: string;
  token: string;
  registrationId: string;
  tenant: string;
}

/**
 * Get tenant email settings from database
 */
async function getTenantEmailSettings(tenantId: string, knex: any): Promise<TenantEmailSettings | null> {
  try {
    const settings = await knex('tenant_email_settings')
      .where({ tenant_id: tenantId })
      .first();
    
    if (!settings) {
      console.warn(`No email settings found for tenant ${tenantId}`);
      return null;
    }
    
    return {
      tenantId,
      defaultFromDomain: settings.default_from_domain,
      customDomains: settings.custom_domains || [],
      emailProvider: settings.email_provider,
      providerConfigs: settings.provider_configs || [],
      fallbackEnabled: settings.fallback_enabled,
      trackingEnabled: settings.tracking_enabled,
      maxDailyEmails: settings.max_daily_emails
    };
  } catch (error) {
    console.error(`Error fetching tenant email settings:`, error);
    return null;
  }
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

      // Get tenant email settings and initialize provider manager
      const tenantSettings = await getTenantEmailSettings(tenant, knex);
      
      if (!tenantSettings) {
        throw new Error(`No email settings configured for tenant ${tenant}`);
      }
      
      const emailProviderManager = new EmailProviderManager();
      await emailProviderManager.initialize(tenantSettings);

      // Get template content using tenant-aware connection
      const templateKnex = await getConnection(tenant);
      
      // Try to get tenant-specific template first
      let template = await templateKnex('tenant_email_templates')
        .where({ tenant, name: 'email-verification' })
        .first();
      
      // Fall back to system template if no tenant template
      if (!template) {
        template = await templateKnex('system_email_templates')
          .where({ name: 'email-verification' })
          .first();
      }
      
      if (!template) {
        throw new Error('Email verification template not found');
      }

      // Replace template variables
      let html = template.html_content;
      const templateData = {
        email,
        verificationUrl,
        registrationCompanyName: registrationCompany.company_name,
        tenantCompanyName: tenantCompany.company_name,
        currentYear: new Date().getFullYear()
      };

      // Replace template variables
      Object.entries(templateData).forEach(([key, value]) => {
        const placeholder = new RegExp(`{{${key}}}`, 'g');
        html = html.replace(placeholder, String(value));
      });

      const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      
      // Create email message
      const emailMessage: EmailMessage = {
        to: email,
        subject: template.subject || 'Verify your email address',
        html,
        text
      };

      // Send email using provider manager
      const result = await emailProviderManager.sendEmail(emailMessage, tenant);

      if (!result.success) {
        throw new Error(`Failed to send email: ${result.error || 'Unknown error'}`);
      }

      return true;
    });
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
}
