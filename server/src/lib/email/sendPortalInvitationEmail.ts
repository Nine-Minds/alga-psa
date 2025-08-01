'use server'

import { createTenantKnex, runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';
import { EmailProviderManager } from 'server/src/services/email/EmailProviderManager';
import { TenantEmailSettings, EmailMessage } from 'server/src/types/email.types';

interface SendPortalInvitationEmailParams {
  email: string;
  contactName: string;
  companyName: string;
  portalLink: string;
  expirationTime: string;
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
      trackingEnabled: settings.tracking_enabled,
      maxDailyEmails: settings.max_daily_emails,
      createdAt: settings.created_at,
      updatedAt: settings.updated_at
    };
  } catch (error) {
    console.error(`Error fetching tenant email settings:`, error);
    return null;
  }
}

export async function sendPortalInvitationEmail({ 
  email, 
  contactName,
  companyName,
  portalLink,
  expirationTime,
  tenant 
}: SendPortalInvitationEmailParams): Promise<boolean> {
  try {
    return await runWithTenant(tenant, async () => {
      const { knex } = await createTenantKnex();

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
        .where({ tenant, name: 'portal-invitation' })
        .first();
      
      // Fall back to system template if no tenant template
      if (!template) {
        template = await templateKnex('system_email_templates')
          .where({ name: 'portal-invitation' })
          .first();
      }
      
      if (!template) {
        throw new Error('Portal invitation template not found');
      }

      // Replace template variables
      let htmlContent = template.html_content;
      let textContent = template.text_content;
      let subject = template.subject;
      
      const templateData = {
        contactName,
        companyName,
        portalLink,
        expirationTime,
        currentYear: new Date().getFullYear()
      };

      // Replace template variables in all content
      Object.entries(templateData).forEach(([key, value]) => {
        const placeholder = new RegExp(`{{${key}}}`, 'g');
        htmlContent = htmlContent.replace(placeholder, String(value));
        textContent = textContent.replace(placeholder, String(value));
        subject = subject.replace(placeholder, String(value));
      });
      
      // Create email message
      const emailMessage: EmailMessage = {
        from: { email: `noreply@${tenantSettings.defaultFromDomain || 'localhost'}` },
        to: [{ email }],
        subject,
        html: htmlContent,
        text: textContent
      };

      // Send email using provider manager
      const result = await emailProviderManager.sendEmail(emailMessage, tenant);

      if (!result.success) {
        throw new Error(`Failed to send email: ${result.error || 'Unknown error'}`);
      }

      return true;
    });
  } catch (error) {
    console.error('Error sending portal invitation email:', error);
    return false;
  }
}