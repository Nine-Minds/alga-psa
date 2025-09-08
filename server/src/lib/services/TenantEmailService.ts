import { Knex } from 'knex';
import { createTenantKnex } from '../db';
import { getConnection } from '../db/db';
import { EmailProviderManager } from '../../services/email/EmailProviderManager';
import { 
  TenantEmailSettings, 
  EmailAddress,
  IEmailProvider
} from '../../types/email.types';
import logger from '@alga-psa/shared/core/logger.js';
import { 
  ITemplateProcessor
} from './email/templateProcessors';
import { BaseEmailService, BaseEmailParams, EmailSendResult } from '../email/BaseEmailService';

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

export class TenantEmailService extends BaseEmailService {
  private static instances: Map<string, TenantEmailService> = new Map();
  private tenantId: string;
  private providerManager: EmailProviderManager | null = null;

  private constructor(tenantId: string) {
    super();
    this.tenantId = tenantId;
  }

  /**
   * Get or create a singleton instance per tenant
   */
  public static getInstance(tenantId: string): TenantEmailService {
    if (!TenantEmailService.instances.has(tenantId)) {
      TenantEmailService.instances.set(tenantId, new TenantEmailService(tenantId));
    }
    return TenantEmailService.instances.get(tenantId)!;
  }

  protected getServiceName(): string {
    return `TenantEmailService[${this.tenantId}]`;
  }

  protected async getEmailProvider(): Promise<IEmailProvider | null> {
    if (!this.providerManager) {
      const { knex } = await createTenantKnex();
      const settings = await TenantEmailService.getTenantEmailSettings(this.tenantId, knex);
      
      if (!settings) {
        logger.warn(`[${this.getServiceName()}] No email settings found`);
        return null;
      }
      
      this.providerManager = new EmailProviderManager();
      await this.providerManager.initialize(settings);
    }
    
    const providers = await this.providerManager.getAvailableProviders(this.tenantId);
    return providers.length > 0 ? providers[0] : null;
  }

  protected getFromAddress(params?: BaseEmailParams): EmailAddress | string {
    if (params?.from) {
      return params.from as EmailAddress | string;
    }
    // Default from address will be handled by the provider
    return { email: 'noreply@localhost', name: 'Portal Notifications' };
  }
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
        .where({ tenant: tenantId })
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
   * @deprecated Use instance method sendEmail instead
   */
  static async sendEmail(params: SendEmailParams): Promise<EmailSendResult> {
    const { tenantId } = params;
    const service = TenantEmailService.getInstance(tenantId);
    await service.initialize();
    
    // Convert params to BaseEmailParams format
    const baseParams: BaseEmailParams = {
      to: params.to,
      cc: params.cc,
      bcc: params.bcc,
      attachments: params.attachments,
      replyTo: params.replyTo,
      templateProcessor: params.templateProcessor,
      templateData: params.templateData,
      from: params.from,
      tenantId
    };
    
    return service.sendEmail(baseParams);
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