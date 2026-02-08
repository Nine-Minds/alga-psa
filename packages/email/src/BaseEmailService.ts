import logger from '@alga-psa/core/logger';
import {
  IEmailProvider,
  EmailMessage as ProviderEmailMessage,
  EmailSendResult as ProviderEmailSendResult,
  EmailAddress as ProviderEmailAddress
} from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { SupportedLocale } from './lib/localeConfig';

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  queued?: boolean;      // true if queued for later delivery due to rate limiting
  retryCount?: number;   // current retry attempt (0 = first attempt)
}

export interface ITemplateProcessor {
  process(options: TemplateProcessorOptions): Promise<EmailTemplateContent>;
}

export interface TemplateProcessorOptions {
  templateData?: Record<string, any>;
  tenantId?: string;
  locale?: SupportedLocale;
}

export interface EmailTemplateContent {
  subject: string;
  html: string;
  text: string;
}

export interface BaseEmailParams {
  to: string | string[] | EmailAddress | EmailAddress[];
  cc?: string[] | EmailAddress[];
  bcc?: string[] | EmailAddress[];
  attachments?: any[];
  replyTo?: string | EmailAddress;
  templateProcessor?: ITemplateProcessor;
  templateData?: Record<string, any>;
  headers?: Record<string, string>;
  providerId?: string;
  userId?: string;  // For per-user rate limiting (optional)
  /**
   * Optional entity association context for downstream logging/analytics.
   * These are persisted to `email_sending_logs` when available.
   */
  entityType?: string;
  entityId?: string;
  contactId?: string;
  notificationSubtypeId?: number;
  // Allow subclasses to add their own parameters
  [key: string]: any;
}

/**
 * BaseEmailService - Abstract base class for all email services
 * 
 * Provides common functionality for email sending including:
 * - Template processing
 * - Email sending via email providers
 * - Error handling and logging
 * - Result formatting
 * 
 * Subclasses must implement:
 * - getEmailProvider() - How to get the email provider instance
 * - getFromAddress() - How to determine the from address
 * - getServiceName() - Service name for logging
 */
export abstract class BaseEmailService {
  protected initialized: boolean = false;
  protected emailProvider: IEmailProvider | null = null;
  protected static readonly EMAIL_LOG_TABLE = 'email_sending_logs';

  /**
   * Get email provider instance
   */
  protected abstract getEmailProvider(): Promise<IEmailProvider | null>;

  /**
   * Get the from address for emails
   */
  protected abstract getFromAddress(params?: BaseEmailParams): EmailAddress | string;

  /**
   * Get service name for logging
   */
  protected abstract getServiceName(): string;

  /**
   * Initialize the email service
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.emailProvider = await this.getEmailProvider();
      if (!this.emailProvider) {
        logger.info(`[${this.getServiceName()}] Email service disabled or not configured`);
      } else {
        logger.info(`[${this.getServiceName()}] Email provider initialized: ${this.emailProvider.providerId}`);
      }
    } catch (error) {
      logger.error(`[${this.getServiceName()}] Failed to initialize email provider:`, error);
      this.emailProvider = null;
    }

    this.initialized = true;
  }

  /**
   * Send an email with optional template processing
   */
  public async sendEmail(params: BaseEmailParams): Promise<EmailSendResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.emailProvider) {
      logger.warn(`[${this.getServiceName()}] Service disabled or not configured`);
      return {
        success: false,
        error: 'Email service is disabled or not configured'
      };
    }

    let emailMessage: ProviderEmailMessage | null = null;

    try {
      let subject: string;
      let html: string;
      let text: string | undefined;

      // Process template if processor is provided
      if (params.templateProcessor) {
        const templateContent = await params.templateProcessor.process({
          templateData: params.templateData,
          tenantId: params.tenantId,
          locale: params.locale
        });
        subject = templateContent.subject;
        html = templateContent.html;
        text = templateContent.text;
      } else {
        // Expect subject, html, and text to be provided directly
        subject = params.subject || 'No Subject';
        html = params.html || '';
        text = params.text;
      }

      // Get from address
      const from = this.convertToProviderAddress(this.getFromAddress(params));
      // Log resolved From for visibility (email + name)
      logger.info(`[${this.getServiceName()}] Using From address:`, {
        email: from.email,
        name: from.name || null
      });
      
      // Convert to provider email message format
      emailMessage = {
        from,
        to: this.convertToProviderAddressArray(params.to),
        cc: params.cc ? this.convertToProviderAddressArray(params.cc) : undefined,
        bcc: params.bcc ? this.convertToProviderAddressArray(params.bcc) : undefined,
        replyTo: params.replyTo ? this.convertToProviderAddress(params.replyTo) : undefined,
        subject,
        html,
        text,
        attachments: params.attachments,
        headers: params.headers
      };

      // Send via provider
      const result = await this.emailProvider.sendEmail(emailMessage, params.tenantId || 'system');

      // Best-effort: persist provider-level send result for auditing/debugging.
      void this.logEmailSendResult({
        tenantId: typeof params.tenantId === 'string' ? params.tenantId : null,
        providerResult: result,
        message: emailMessage,
        entityType: params.entityType,
        entityId: params.entityId,
        contactId: params.contactId,
        notificationSubtypeId: params.notificationSubtypeId,
      });

      if (result.success) {
        logger.info(`[${this.getServiceName()}] Email sent successfully:`, {
          messageId: result.messageId,
          to: emailMessage.to,
          subject
        });
      }

      // Convert provider result to our result format
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error
      };
    } catch (error) {
      // Best-effort: log provider failure if we made it to message construction.
      if (emailMessage) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const providerId = this.emailProvider?.providerId ?? 'unknown';
        const providerType = this.emailProvider?.providerType ?? 'unknown';

        void this.logEmailSendResult({
          tenantId: typeof params.tenantId === 'string' ? params.tenantId : null,
          providerResult: {
            success: false,
            messageId: undefined,
            providerId,
            providerType,
            error: errorMessage,
            metadata: { error: errorMessage },
            sentAt: new Date(),
          } satisfies ProviderEmailSendResult,
          message: emailMessage,
          entityType: params.entityType,
          entityId: params.entityId,
          contactId: params.contactId,
          notificationSubtypeId: params.notificationSubtypeId,
        });
      }

      logger.error(`[${this.getServiceName()}] Failed to send email:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  protected async logEmailSendResult(params: {
    tenantId: string | null;
    providerResult: ProviderEmailSendResult;
    message: ProviderEmailMessage;
    entityType?: string;
    entityId?: string;
    contactId?: string;
    notificationSubtypeId?: number;
  }): Promise<void> {
    if (!params.tenantId) return;

    try {
      const { knex } = await createTenantKnex(params.tenantId);

      const toAddresses = params.message.to.map((addr) => addr.email);
      const ccAddresses = params.message.cc?.map((addr) => addr.email) ?? null;
      const bccAddresses = params.message.bcc?.map((addr) => addr.email) ?? null;

      await knex(BaseEmailService.EMAIL_LOG_TABLE).insert({
        tenant: params.tenantId,
        message_id: params.providerResult.messageId ?? null,
        provider_id: params.providerResult.providerId,
        provider_type: params.providerResult.providerType,
        from_address: params.message.from.email,
        to_addresses: JSON.stringify(toAddresses),
        cc_addresses: ccAddresses ? JSON.stringify(ccAddresses) : null,
        bcc_addresses: bccAddresses ? JSON.stringify(bccAddresses) : null,
        subject: params.message.subject,
        status: params.providerResult.success ? 'sent' : 'failed',
        error_message: params.providerResult.error ?? null,
        metadata: params.providerResult.metadata ?? null,
        sent_at: params.providerResult.sentAt ?? new Date(),
        entity_type: params.entityType ?? null,
        entity_id: params.entityId ?? null,
        contact_id: params.contactId ?? null,
        notification_subtype_id: params.notificationSubtypeId ?? null,
      });
    } catch (error) {
      logger.warn(`[${this.getServiceName()}] Failed to write email_sending_logs record`, {
        tenantId: params.tenantId,
        providerId: params.providerResult.providerId,
        providerType: params.providerResult.providerType,
        status: params.providerResult.success ? 'sent' : 'failed',
        subject: params.message.subject,
        toCount: params.message.to.length,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Check if email service is configured and ready
   */
  public async isConfigured(): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.emailProvider !== null;
  }

  /**
   * Convert to provider email address format
   */
  protected convertToProviderAddress(address: string | EmailAddress): ProviderEmailAddress {
    if (typeof address === 'string') {
      return { email: address };
    }
    return { email: address.email, name: address.name };
  }

  /**
   * Convert to provider email address array
   */
  protected convertToProviderAddressArray(
    addresses: string | string[] | EmailAddress | EmailAddress[]
  ): ProviderEmailAddress[] {
    const addressArray = Array.isArray(addresses) ? addresses : [addresses];
    return addressArray.map(addr => this.convertToProviderAddress(addr));
  }

  /**
   * Replace template variables with actual values
   * Utility method for simple template processing
   */
  protected replaceTemplateVariables(
    template: string,
    data: Record<string, any>
  ): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, key) => {
      const keys = key.split('.');
      let value: any = data;
      
      for (const k of keys) {
        value = value?.[k];
      }
      
      return value !== undefined ? String(value) : match;
    });
  }
}
