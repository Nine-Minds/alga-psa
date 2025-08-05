import { Knex } from 'knex';
import { createTenantKnex, runWithTenant } from '../db';
import { getConnection } from '../db/db';
import { EmailProviderManager } from '../../services/email/EmailProviderManager';
import { 
  TenantEmailSettings, 
  EmailMessage, 
  EmailSendResult,
  EmailAddress
} from '../../types/email.types';
import logger from '@alga-psa/shared/core/logger.js';
import { 
  ITemplateProcessor, 
  DatabaseTemplateProcessor,
  EmailTemplateContent 
} from './email/templateProcessors';

export interface SendEmailParams {
  tenantId: string;
  to: string | EmailAddress;
  templateData?: Record<string, any>;
  from?: EmailAddress;
  fromName?: string;
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  attachments?: any[];
  replyTo?: EmailAddress;
  templateProcessor: ITemplateProcessor;
}

export interface EmailSettingsValidation {
  valid: boolean;
  error?: string;
  settings?: TenantEmailSettings;
}

export class TenantEmailService {
  /**
   * Get tenant email settings from database
   * This is the centralized method that should be used across the application
   */
  static async getTenantEmailSettings(
    tenantId: string, 
    knex: Knex | Knex.Transaction
  ): Promise<TenantEmailSettings | null> {
    try {
      const settings = await knex('tenant_email_settings')
        .where({ tenant_id: tenantId })
        .first();
      
      if (!settings) {
        logger.warn(`[TenantEmailService] No email settings found for tenant ${tenantId}`);
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
      logger.error(`[TenantEmailService] Error fetching tenant email settings:`, error);
      return null;
    }
  }


  /**
   * Send an email with automatic provider initialization and template support
   */
  static async sendEmail(params: SendEmailParams): Promise<EmailSendResult> {
    const { tenantId } = params;
    
    try {
      return await runWithTenant(tenantId, async () => {
        const { knex } = await createTenantKnex();
        
        // Get tenant email settings
        const tenantSettings = await this.getTenantEmailSettings(tenantId, knex);
        
        if (!tenantSettings) {
          throw new Error('Email service is not configured. Please contact your administrator to set up email settings.');
        }
        
        // Initialize email provider manager
        const emailProviderManager = new EmailProviderManager();
        await emailProviderManager.initialize(tenantSettings);
        
        // Process template to get content
        const templateContent = await params.templateProcessor.process({
          tenantId,
          templateData: params.templateData
        });
        
        const subject = templateContent.subject;
        const htmlContent = templateContent.html;
        const textContent = templateContent.text;
        
        // Normalize email address
        const toAddress: EmailAddress = typeof params.to === 'string' 
          ? { email: params.to }
          : params.to;

        // Create email message
        const emailMessage: EmailMessage = {
          from: params.from || { 
            email: `noreply@${tenantSettings.defaultFromDomain}`,
            name: params.fromName || 'Portal Notifications'
          },
          to: [toAddress],
          cc: params.cc,
          bcc: params.bcc,
          subject,
          html: htmlContent,
          text: textContent,
          attachments: params.attachments,
          replyTo: params.replyTo
        };
        
        // Send email using provider manager
        const result = await emailProviderManager.sendEmail(emailMessage, tenantId);
        
        if (!result.success) {
          throw new Error(`Failed to send email: ${result.error || 'Unknown error'}`);
        }
        
        return result;
      });
    } catch (error) {
      logger.error('[TenantEmailService] Error sending email:', error);
      throw error;
    }
  }

  /**
   * Validate that email settings are properly configured for a tenant
   */
  static async validateEmailSettings(tenantId: string): Promise<EmailSettingsValidation> {
    try {
      const { knex } = await createTenantKnex();
      const settings = await this.getTenantEmailSettings(tenantId, knex);
      
      if (!settings) {
        return {
          valid: false,
          error: 'Email settings are not configured for your organization. Please contact your administrator to set up email services.'
        };
      }
      
      // Check if at least one provider is enabled
      const hasEnabledProvider = settings.providerConfigs.some(config => config.isEnabled);
      
      if (!hasEnabledProvider) {
        return {
          valid: false,
          error: 'No email provider is enabled. Please enable at least one email provider in settings.'
        };
      }    
      
      // Check if default from domain is set
      if (!settings.defaultFromDomain || settings.defaultFromDomain === 'localhost') {
        return {
          valid: false,
          error: 'Default from domain is not configured. Please set a valid domain in email settings.'
        };
      }
      
      return {
        valid: true,
        settings
      };
    } catch (error) {
      logger.error('[TenantEmailService] Error validating email settings:', error);
      return {
        valid: false,
        error: 'Failed to validate email settings'
      };
    }
  }
}