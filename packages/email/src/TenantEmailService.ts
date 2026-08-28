import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { tenantDb, getConnection, isTenantSuspended } from '@alga-psa/db';
import { EmailProviderManager } from './providers/EmailProviderManager';
import { 
  TenantEmailSettings, 
  EmailAddress,
  IEmailProvider,
  EmailMessage,
  EmailProviderConfig,
  EmailProviderError,
} from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import {
  ITemplateProcessor
} from './templateProcessors';
import { SupportedLocale } from './lib/localeConfig';
import { BaseEmailService, BaseEmailParams, EmailSendResult } from './BaseEmailService';
import { SystemEmailProviderFactory } from './system/SystemEmailProviderFactory';
import { isEnterprise } from './features';
import { DelayedEmailQueue } from './DelayedEmailQueue';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';
import {
  applyFromNameOverride,
  parseEmailAddress,
  resolveDefaultFromAddress,
  resolveTenantCompanyName,
} from './senderIdentity';

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
  /**
   * Recipient locale, forwarded to the template processor for language-aware
   * template lookup (system_email_templates.language_code).
   */
  locale?: SupportedLocale;
}

export interface EmailSettingsValidation {
  valid: boolean;
  error?: string;
  settings?: TenantEmailSettings;
}

interface TenantProviderSnapshot {
  emailProvider: IEmailProvider | null;
  providerInitError: string | null;
  fromAddress: EmailAddress;
  systemFallbackFromAddress?: EmailAddress;
}

function isValidEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export class TenantEmailService extends BaseEmailService {
  private static instances: Map<string, TenantEmailService> = new Map();
  private tenantId: string;
  private providerManager: EmailProviderManager | null = null;
  private tenantSettings: TenantEmailSettings | null = null;
  private tenantSettingsLoaded = false;
  private providerSettingsFingerprint: string | null = null;
  private providerStateQueue: Promise<void> = Promise.resolve();
  private usingSystemProvider = false;

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

  /**
   * Clear one tenant's process-local provider state after an email settings
   * save. The instance itself is reset before it is evicted so callers holding
   * an older reference cannot continue using the prior credentials.
   */
  public static async invalidateTenantSettings(tenantId: string): Promise<void> {
    const instance = TenantEmailService.instances.get(tenantId);
    if (!instance) return;

    await instance.withProviderStateLock(async () => {
      instance.resetProviderState();
    });

    if (TenantEmailService.instances.get(tenantId) === instance) {
      TenantEmailService.instances.delete(tenantId);
    }
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

    // Belt-and-braces: no tenant-scoped email leaves a suspended tenant
    // (cancelled, pending deletion) even if some generator was missed by the
    // job/event gates. System emails (win-back, reactivation) go through
    // SystemEmailService and are unaffected. isTenantSuspended fails open.
    const suspensionKnex = await getConnection(this.tenantId);
    const [tenantSuspended, resolvedTenantCompanyName] = await Promise.all([
      isTenantSuspended(suspensionKnex, this.tenantId),
      resolveTenantCompanyName(suspensionKnex, this.tenantId),
    ]);
    if (tenantSuspended) {
      logger.info(`[${this.getServiceName()}] Dropping email for suspended tenant`, {
        tenantId: this.tenantId,
        to: params.to,
        event: 'email_dropped_tenant_suspended'
      });
      return {
        success: false,
        error: 'Tenant is suspended; outbound email is disabled'
      };
    }

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

    // Settings actions invalidate this cache in-process for an immediate
    // refresh. The database check on every actual send also covers saves made
    // by another server process and direct settings updates outside that action.
    const providerSnapshot = await this.refreshProviderState(
      suspensionKnex,
      resolvedTenantCompanyName
    );

    return super.sendEmail({
      ...params,
      resolvedTenantCompanyName,
      resolvedTenantFromAddress: providerSnapshot.fromAddress,
      resolvedEmailProvider: providerSnapshot.emailProvider,
      resolvedProviderInitError: providerSnapshot.providerInitError,
      ...(providerSnapshot.systemFallbackFromAddress ? {
        resolvedSystemFallbackFromAddress: providerSnapshot.systemFallbackFromAddress,
        resolvedSystemFallbackReplyTo: providerSnapshot.fromAddress,
      } : {}),
    });
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
      const result = await rateLimiter.tryConsume('email', this.tenantId, params.userId);

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
      let settings: TenantEmailSettings | null = this.tenantSettingsLoaded
        ? this.tenantSettings
        : null;
      try {
        if (!this.tenantSettingsLoaded) {
          const knex = await getConnection(this.tenantId);
          settings = await TenantEmailService.getTenantEmailSettings(this.tenantId, knex);
          this.tenantSettings = settings;
          this.tenantSettingsLoaded = true;
        }

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

        // Preserve the real cause (e.g. "SMTP initialization failed: ...") so it
        // can surface to the admin if no working provider is available.
        const realError = error instanceof Error ? error.message : String(error);

        if (isEnterprise) {
          logger.info(`[${this.getServiceName()}] Using system email provider (Enterprise Edition)`);
          try {
            const systemProvider = await SystemEmailProviderFactory.createProvider();
            if (systemProvider) {
              this.usingSystemProvider = true;
              return systemProvider;
            }
          } catch (fallbackError) {
            logger.error(`[${this.getServiceName()}] Failed to create system email provider:`, fallbackError);
          }
          // No system fallback available: the tenant provider error is the real
          // reason sending is unavailable, so don't mask it as "disabled".
          this.providerInitError = realError;
          return null;
        }

        throw error;
      }
    }

    // Use tenant-configured provider first (SMTP, Resend, etc.)
    if (this.providerManager) {
      const providers = await this.providerManager.getAvailableProviders(this.tenantId);
      if (providers.length > 0) {
        logger.info(`[${this.getServiceName()}] Using tenant-configured provider: ${providers[0].providerId} (${providers[0].providerType})`);
        return providers[0];
      }
    }

    // Fall back to system provider in Enterprise Edition when no tenant provider is configured
    if (isEnterprise) {
      logger.info(`[${this.getServiceName()}] No tenant provider configured, using system email provider (Enterprise Edition)`);
      try {
        const systemProvider = await SystemEmailProviderFactory.createProvider();
        this.usingSystemProvider = Boolean(systemProvider);
        return systemProvider;
      } catch (err) {
        logger.error(`[${this.getServiceName()}] Failed to create system email provider:`, err);
        return null;
      }
    }

    logger.error(`[${this.getServiceName()}] No email provider available`);
    return null;
  }

  protected getFromAddress(params?: BaseEmailParams): EmailAddress | string {
    if (params?.resolvedSystemFallbackFromAddress) {
      return params.resolvedSystemFallbackFromAddress;
    }

    const resolved = params?.from
      ? params.from as EmailAddress | string
      : params?.resolvedTenantFromAddress
        ?? this.buildTenantFromAddress(params?.resolvedTenantCompanyName);
    return applyFromNameOverride(resolved, params?.fromName);
  }

  public override async isConfigured(): Promise<boolean> {
    const knex = await getConnection(this.tenantId);
    const providerSnapshot = await this.refreshProviderState(knex);
    return providerSnapshot.emailProvider !== null;
  }

  public override async getInitializationError(): Promise<string | null> {
    const knex = await getConnection(this.tenantId);
    const providerSnapshot = await this.refreshProviderState(knex);
    return providerSnapshot.providerInitError;
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
      return await TenantEmailService.loadTenantEmailSettings(tenantId, knex);
    } catch (error) {
      logger.error(`[TenantEmailService] Error fetching tenant email settings:`, error);
      return null;
    }
  }

  /**
   * Verify the tenant's outbound provider configuration and, optionally, send a
   * test message. Uses a fresh provider manager (not the cached singleton) so it
   * always reflects the currently-saved settings and returns the real failure
   * reason (SMTP auth/TLS/connection error) rather than a generic message.
   */
  static async testConnection(
    tenantId: string,
    toAddress?: string
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    const knex = await getConnection(tenantId);
    const settings = await this.getTenantEmailSettings(tenantId, knex);

    if (!settings) {
      return { success: false, error: 'No outbound email settings are configured.' };
    }

    const enabled = settings.providerConfigs.find(config => config.isEnabled);
    if (!enabled) {
      return { success: false, error: 'No outbound email provider is enabled.' };
    }

    const manager = new EmailProviderManager();
    try {
      // For SMTP this opens a connection and runs verify() (incl. AUTH/TLS).
      await manager.initialize(settings);
    } catch (error) {
      if (error instanceof EmailProviderError) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'The outbound email provider could not be initialized. Check host, credentials, and security settings.' };
    }

    const providers = await manager.getAvailableProviders(tenantId);
    if (providers.length === 0) {
      return { success: false, error: 'The provider did not initialize. Check host, port, and credentials.' };
    }

    const providerLabel = enabled.providerType.toUpperCase();
    if (!toAddress) {
      return { success: true, message: `${providerLabel} connection verified.` };
    }

    const tenantCompanyName = await resolveTenantCompanyName(knex, tenantId);
    const from = resolveDefaultFromAddress(settings, tenantCompanyName);

    const message: EmailMessage = {
      from,
      to: [{ email: toAddress }],
      subject: 'AlgaPSA outbound email test',
      text: 'This is a test message confirming your outbound email configuration works.',
      html: '<p>This is a test message confirming your outbound email configuration works.</p>'
    };

    try {
      const result = await manager.sendEmail(message, tenantId);
      if (result.success) {
        return { success: true, message: `Test email sent to ${toAddress} via ${providerLabel}.` };
      }
      return { success: false, error: result.error || 'The provider rejected the test message.' };
    } catch (error) {
      if (error instanceof EmailProviderError) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Failed to send the test email. Check provider settings and try again.' };
    }
  }


  /**
   * Send an email with automatic provider initialization and template support
   * @deprecated Use instance method sendEmail instead
   */
  static async sendEmail(params: SendEmailParams): Promise<EmailSendResult> {
    const { tenantId } = params;
    const service = TenantEmailService.getInstance(tenantId);
    
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
      fromName: params.fromName,
      tenantId,
      locale: params.locale
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
      ticketingFromName: settings.ticketing_from_name || null,
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

  private buildTenantFromAddress(tenantCompanyName?: string | null): EmailAddress {
    return TenantEmailService.getDefaultFromAddress(this.tenantSettings, tenantCompanyName);
  }

  private async withProviderStateLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.providerStateQueue;
    let release!: () => void;
    this.providerStateQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async refreshProviderState(
    knex: Knex | Knex.Transaction,
    tenantCompanyName?: string | null
  ): Promise<TenantProviderSnapshot> {
    return this.withProviderStateLock(async () => {
      // Unlike the public compatibility helper, this strict read does not turn
      // a transient database error into "no settings" and accidentally replace
      // a working tenant provider with the system fallback.
      const settings = await TenantEmailService.loadTenantEmailSettings(this.tenantId, knex);
      const fingerprint = TenantEmailService.getProviderSettingsFingerprint(settings);

      if (this.initialized && fingerprint === this.providerSettingsFingerprint) {
        // Retain the freshly-normalized object even when its provider-relevant
        // values are unchanged so From resolution never depends on old state.
        this.tenantSettings = settings;
        this.tenantSettingsLoaded = true;
        return {
          emailProvider: this.emailProvider,
          providerInitError: this.providerInitError,
          fromAddress: this.buildTenantFromAddress(tenantCompanyName),
          ...(this.usingSystemProvider ? {
            systemFallbackFromAddress: this.buildSystemFallbackFromAddress(tenantCompanyName),
          } : {}),
        };
      }

      this.resetProviderState();
      this.tenantSettings = settings;
      this.tenantSettingsLoaded = true;
      await this.initialize();
      this.providerSettingsFingerprint = fingerprint;
      return {
        emailProvider: this.emailProvider,
        providerInitError: this.providerInitError,
        fromAddress: this.buildTenantFromAddress(tenantCompanyName),
        ...(this.usingSystemProvider ? {
          systemFallbackFromAddress: this.buildSystemFallbackFromAddress(tenantCompanyName),
        } : {}),
      };
    });
  }

  private resetProviderState(): void {
    this.initialized = false;
    this.emailProvider = null;
    this.providerInitError = null;
    this.providerManager = null;
    this.tenantSettings = null;
    this.tenantSettingsLoaded = false;
    this.providerSettingsFingerprint = null;
    this.usingSystemProvider = false;
  }

  private static getProviderSettingsFingerprint(settings: TenantEmailSettings | null): string {
    const providerState = {
      defaultFromDomain: settings?.defaultFromDomain ?? null,
      emailProvider: settings?.emailProvider ?? null,
      providerConfigs: settings?.providerConfigs ?? [],
      // Every settings action advances updatedAt. Including it makes a save an
      // explicit cross-process refresh signal even if the submitted provider
      // values happen to be identical to the prior values.
      updatedAt: settings?.updatedAt ?? null,
      // Enterprise tenant mail can fall back directly to the system provider,
      // so its environment-backed credentials are part of this snapshot too.
      systemProvider: isEnterprise
        ? SystemEmailProviderFactory.getConfigFingerprint()
        : null,
    };

    return createHash('sha256').update(JSON.stringify(providerState)).digest('hex');
  }

  private buildSystemFallbackFromAddress(tenantCompanyName?: string | null): EmailAddress {
    const systemAddress = parseEmailAddress(process.env.EMAIL_FROM || process.env.SMTP_FROM);
    if (!systemAddress?.email || !isValidEmailAddress(systemAddress.email)) {
      throw new Error('System fallback sender is missing or malformed; set EMAIL_FROM to a valid, verified system-domain address');
    }

    return {
      email: systemAddress.email,
      name: this.buildTenantFromAddress(tenantCompanyName).name || systemAddress.name,
    };
  }

  private static async loadTenantEmailSettings(
    tenantId: string,
    knex: Knex | Knex.Transaction
  ): Promise<TenantEmailSettings | null> {
    const settings = await tenantDb(knex, tenantId).table('tenant_email_settings')
      .first();

    if (!settings) {
      logger.warn(`[TenantEmailService] No email settings found for tenant ${tenantId}`);
      return null;
    }

    return TenantEmailService.normalizeSettingsRecord(tenantId, settings);
  }

  /**
   * Resolve the tenant's default sender identity (email + display name) purely
   * from persisted settings and environment fallbacks, re-homed onto the
   * configured outbound domain. Exposed as a static so callers that need the
   * resolved address without a configured From override — notably the ticketing
   * subscriber layering a tenant display name onto the default address — reuse
   * this logic instead of re-deriving it.
   */
  static getDefaultFromAddress(
    settings?: TenantEmailSettings | null,
    tenantCompanyName?: string | null
  ): EmailAddress {
    return resolveDefaultFromAddress(settings, tenantCompanyName);
  }
}
