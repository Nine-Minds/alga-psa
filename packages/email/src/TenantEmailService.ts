import { Knex } from 'knex';
import { getConnection } from '@alga-psa/db';
import { EmailProviderManager } from './providers/EmailProviderManager';
import { 
  TenantEmailSettings, 
  EmailAddress,
  IEmailProvider,
  EmailMessage,
  EmailProviderConfig
} from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { 
  ITemplateProcessor
} from './templateProcessors';
import { BaseEmailService, BaseEmailParams, EmailSendResult } from './BaseEmailService';
import { SystemEmailProviderFactory } from './system/SystemEmailProviderFactory';
import { isEnterprise } from './features';
import { DelayedEmailQueue } from './DelayedEmailQueue';
import { TokenBucketRateLimiter } from './TokenBucketRateLimiter';

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
  headers?: Record<string, string>;
  providerId?: string;
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
  private tenantSettings: TenantEmailSettings | null = null;

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

  /**
   * Override sendEmail to support provider-specific routing and rate limiting
   */
  public async sendEmail(params: BaseEmailParams): Promise<EmailSendResult> {
    // Note: We are intentionally ignoring params.providerId for routing purposes.
    // All outbound emails should go through the configured outbound provider (e.g. Resend/SMTP).
    // The providerId from ticket metadata is used upstream (in ticketEmailSubscriber) to resolve
    // the correct 'From' address, which is passed in params.from.

    // Check rate limits before sending
    const rateLimitResult = await this.checkRateLimits(params);
    if (!rateLimitResult.allowed) {
      const retryCount = params._retryCount ?? 0;

      // Check if we've exceeded max retries
      if (retryCount >= DelayedEmailQueue.MAX_RETRIES) {
        logger.error(`[${this.getServiceName()}] Max retries exceeded, dropping email`, {
          tenantId: this.tenantId,
          to: params.to,
          retryCount
        });
        return {
          success: false,
          error: `Rate limit exceeded after ${retryCount} retries`
        };
      }

      // Try to queue for retry if the queue is initialized
      const queue = DelayedEmailQueue.getInstance();
      if (queue.isReady()) {
        try {
          await queue.enqueue(this.tenantId, params, retryCount);

          const nextDelay = DelayedEmailQueue.calculateDelay(retryCount);
          logger.info(`[${this.getServiceName()}] Rate limited, queued for retry`, {
            tenantId: this.tenantId,
            to: params.to,
            retryCount,
            nextRetryInMs: nextDelay
          });

          return {
            success: true,  // Queued successfully counts as success
            queued: true,
            retryCount
          };
        } catch (queueError) {
          logger.error(`[${this.getServiceName()}] Failed to queue email for retry`, {
            error: queueError instanceof Error ? queueError.message : 'Unknown error',
            tenantId: this.tenantId,
            to: params.to
          });
          // Fall through to return the rate limit error
        }
      } else {
        logger.warn(`[${this.getServiceName()}] Rate limit exceeded, queue not available`, {
          reason: rateLimitResult.reason,
          tenantId: this.tenantId,
          to: params.to,
          userId: params.userId
        });
      }

      return {
        success: false,
        error: `Rate limit exceeded: ${rateLimitResult.reason}`
      };
    }

    return super.sendEmail(params);
  }

  /**
   * Check rate limits for the tenant/user combination using token bucket algorithm
   *
   * Token bucket provides smoother rate limiting:
   * - Allows controlled bursts up to maxTokens
   * - Tokens refill at a steady rate (default: 1/second)
   * - No database queries needed (Redis only)
   * - Fails open if rate limiter unavailable
   */
  private async checkRateLimits(params: BaseEmailParams): Promise<{ allowed: boolean; reason?: string; retryAfterMs?: number }> {
    const rateLimiter = TokenBucketRateLimiter.getInstance();

    // Fail open if rate limiter is not initialized
    if (!rateLimiter.isReady()) {
      logger.debug(`[${this.getServiceName()}] Rate limiter not ready, allowing request`);
      return { allowed: true };
    }

    try {
      const result = await rateLimiter.tryConsume(this.tenantId, params.userId);

      if (!result.allowed) {
        return {
          allowed: false,
          reason: result.reason ?? 'Rate limit exceeded',
          retryAfterMs: result.retryAfterMs
        };
      }

      return { allowed: true };
    } catch (error) {
      // Fail open on error
      logger.error(`[${this.getServiceName()}] Rate limit check failed, allowing request:`, error);
      return { allowed: true };
    }
  }

  protected async getEmailProvider(): Promise<IEmailProvider | null> {
    if (!this.providerManager) {
      let settings: TenantEmailSettings | null = null;
      try {
        const knex = await getConnection(this.tenantId);
        settings = await TenantEmailService.getTenantEmailSettings(this.tenantId, knex);

        if (settings) {
          this.providerManager = new EmailProviderManager();
          await this.providerManager.initialize(settings);
          this.tenantSettings = settings;
        } else {
          logger.warn(`[${this.getServiceName()}] No tenant email settings found`);
          this.tenantSettings = null;
        }
      } catch (error) {
        logger.error(`[${this.getServiceName()}] Failed to initialize tenant provider:`, error);
        if (settings) {
          this.tenantSettings = settings;
        }

        if (isEnterprise) {
          logger.info(`[${this.getServiceName()}] Using system email provider (Enterprise Edition)`);
          try {
            const systemProvider = await SystemEmailProviderFactory.createProvider();
            return systemProvider;
          } catch (fallbackError) {
            logger.error(`[${this.getServiceName()}] Failed to create system email provider:`, fallbackError);
          }
          return null;
        }

        throw error;
      }
    }

    if (isEnterprise) {
      logger.info(`[${this.getServiceName()}] Using system email provider (Enterprise Edition)`);
      try {
        const systemProvider = await SystemEmailProviderFactory.createProvider();
        return systemProvider;
      } catch (err) {
        logger.error(`[${this.getServiceName()}] Failed to create system email provider:`, err);

        if (this.providerManager) {
          const providers = await this.providerManager.getAvailableProviders(this.tenantId);
          if (providers.length > 0) {
            return providers[0];
          }
        }
        return null;
      }
    }

    if (this.providerManager) {
      const providers = await this.providerManager.getAvailableProviders(this.tenantId);
      if (providers.length > 0) {
        return providers[0];
      }
    }

    logger.error(`[${this.getServiceName()}] No email provider available`);
    return null;
  }

  protected getFromAddress(params?: BaseEmailParams): EmailAddress | string {
    if (params?.from) {
      return params.from as EmailAddress | string;
    }

    const resolved = this.buildTenantFromAddress();
    if (resolved.name) {
      return `${resolved.name} <${resolved.email}>`;
    }
    return resolved.email;
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
      
      return TenantEmailService.normalizeSettingsRecord(tenantId, settings);
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
      const knex = await getConnection(tenantId);
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

  private static normalizeSettingsRecord(tenantId: string, settings: any): TenantEmailSettings {
    return {
      tenantId,
      defaultFromDomain: settings.default_from_domain || undefined,
      ticketingFromEmail: settings.ticketing_from_email || null,
      customDomains: this.normalizeDomains(settings.custom_domains),
      emailProvider: settings.email_provider,
      providerConfigs: this.normalizeProviderConfigs(settings.provider_configs),
      trackingEnabled: Boolean(settings.tracking_enabled),
      maxDailyEmails: settings.max_daily_emails ?? undefined,
      createdAt: settings.created_at,
      updatedAt: settings.updated_at
    };
  }

  private static normalizeDomains(raw: unknown): string[] {
    if (!raw) {
      return [];
    }

    if (Array.isArray(raw)) {
      return raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    }

    if (Buffer.isBuffer(raw)) {
      return this.normalizeDomains(raw.toString('utf8'));
    }

    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        return [];
      }
      try {
        const parsed = JSON.parse(trimmed);
        return this.normalizeDomains(parsed);
      } catch {
        return trimmed
          .split(',')
          .map(part => part.trim())
          .filter(Boolean);
      }
    }

    return [];
  }

  private static normalizeProviderConfigs(raw: unknown): EmailProviderConfig[] {
    if (!raw) {
      return [];
    }

    if (Array.isArray(raw)) {
      return raw as EmailProviderConfig[];
    }

    if (Buffer.isBuffer(raw)) {
      return this.normalizeProviderConfigs(raw.toString('utf8'));
    }

    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed) {
        return [];
      }
      try {
        const parsed = JSON.parse(trimmed);
        return this.normalizeProviderConfigs(parsed);
      } catch (error) {
        logger.warn('[TenantEmailService] Failed to parse provider_configs JSON', {
          error: error instanceof Error ? error.message : error
        });
        return [];
      }
    }

    return [];
  }

  private buildTenantFromAddress(): EmailAddress {
    const providerAddress = this.getProviderConfiguredAddress();
    const envAddress = this.parseAddress(process.env.EMAIL_FROM);
    const fallbackName = providerAddress?.name || envAddress?.name || process.env.EMAIL_FROM_NAME || 'Portal Notifications';
    const fallbackEmail = providerAddress?.email || envAddress?.email || 'notifications@example.com';

    const baseEmail = providerAddress?.email || envAddress?.email || fallbackEmail;
    const emailParts = this.extractEmailParts(baseEmail);
    const localPart = this.sanitizeLocalPart(emailParts?.localPart);

    const configuredDomain = this.sanitizeDomain(this.tenantSettings?.defaultFromDomain);
    const fallbackDomain = this.sanitizeDomain(emailParts?.domain) || this.sanitizeDomain(this.extractDomainFromAddress(fallbackEmail));
    const targetDomain = configuredDomain || fallbackDomain;

    const email = targetDomain ? `${localPart}@${targetDomain}` : baseEmail;

    return {
      email,
      name: fallbackName
    };
  }

  private getProviderConfiguredAddress(): EmailAddress | null {
    const configs = this.tenantSettings?.providerConfigs || [];
    const enabledConfig = configs.find(config => config.isEnabled && config.config);

    if (!enabledConfig) {
      return null;
    }

    const configFrom = enabledConfig.config.from;
    const configFromName = enabledConfig.config.fromName || enabledConfig.config.from_name;
    if (typeof configFrom === 'string' && configFrom.trim().length > 0) {
      const parsed = this.parseAddress(configFrom.trim()) || { email: configFrom.trim() };
      if (!parsed.name && typeof configFromName === 'string' && configFromName.trim().length > 0) {
        parsed.name = configFromName.trim();
      }
      return parsed;
    }

    return null;
  }

  private parseAddress(value?: string | EmailAddress | null): EmailAddress | null {
    if (!value) {
      return null;
    }

    if (typeof value === 'object') {
      if (!value.email) {
        return null;
      }
      return { email: value.email, name: value.name };
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const match = trimmed.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>$/);
    if (match) {
      const name = match[1]?.trim();
      return {
        email: match[2].trim(),
        name: name || undefined
      };
    }

    return { email: trimmed };
  }

  private extractEmailParts(email?: string | null): { localPart: string; domain?: string } | null {
    if (!email) {
      return null;
    }

    const [localPart, domain] = email.split('@');
    if (!domain) {
      return { localPart: localPart || email };
    }

    return { localPart, domain };
  }

  private sanitizeLocalPart(localPart?: string | null): string {
    if (!localPart) {
      return 'notifications';
    }

    const normalized = localPart
      .toLowerCase()
      .replace(/[^a-z0-9._+-]/g, '');

    return normalized || 'notifications';
  }

  private sanitizeDomain(domain?: string | null): string | null {
    if (!domain) {
      return null;
    }

    const normalized = domain.trim().replace(/^@/, '').toLowerCase();
    return normalized || null;
  }

  private extractDomainFromAddress(address?: string): string | null {
    if (!address) {
      return null;
    }

    const parsed = this.parseAddress(address);
    if (!parsed?.email) {
      return null;
    }

    const parts = this.extractEmailParts(parsed.email);
    return parts?.domain || null;
  }
}
