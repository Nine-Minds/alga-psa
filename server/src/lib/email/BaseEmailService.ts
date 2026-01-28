import logger from '@alga-psa/core/logger';
import {
  IEmailProvider,
  EmailMessage as ProviderEmailMessage,
  EmailSendResult as ProviderEmailSendResult,
  EmailAddress as ProviderEmailAddress
} from '../../types/email.types';
import { SupportedLocale } from '@alga-psa/ui/lib/i18n/config';
import { randomUUID } from 'node:crypto';
import { publishWorkflowEvent, type WorkflowActor } from 'server/src/lib/eventBus/publishers';

function extractEmailAddress(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/<([^>]+)>/);
  return (match?.[1] ?? trimmed).replace(/^"+|"+$/g, '');
}

function isUuid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
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
      logger.info(`[${this.getServiceName()}] Email skipped (service disabled or not configured)`);
      return {
        success: false,
        error: 'Email service is disabled or not configured'
      };
    }

    try {
      const tenantId = params.tenantId || 'system';
      const workflowActor: WorkflowActor =
        params.workflowActor && typeof params.workflowActor === 'object'
          ? (params.workflowActor as WorkflowActor)
          : { actorType: 'SYSTEM' };
      const workflowMessageId = randomUUID();

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
      const emailMessage: ProviderEmailMessage = {
        from,
        to: this.convertToProviderAddressArray(params.to),
        cc: params.cc ? this.convertToProviderAddressArray(params.cc) : undefined,
        bcc: params.bcc ? this.convertToProviderAddressArray(params.bcc) : undefined,
        replyTo: params.replyTo ? this.convertToProviderAddress(params.replyTo) : undefined,
        subject,
        html,
        text,
        attachments: params.attachments,
        headers: {
          ...(params.headers || {}),
          'X-Alga-Workflow-Message-Id': workflowMessageId,
          'X-Alga-Tenant-Id': tenantId,
          ...(params.correlationId ? { 'X-Alga-Correlation-Id': String(params.correlationId) } : {}),
        },
        tags: {
          alga_workflow_message_id: workflowMessageId,
          alga_tenant_id: tenantId,
          ...(params.correlationId ? { alga_correlation_id: String(params.correlationId) } : {}),
          ...(isUuid(params.threadId) ? { alga_thread_id: params.threadId } : {}),
          ...(isUuid(params.ticketId) ? { alga_ticket_id: params.ticketId } : {}),
        },
      };

      const maybeThreadId = isUuid(params.threadId) ? params.threadId : undefined;
      const maybeTicketId = isUuid(params.ticketId) ? params.ticketId : undefined;

      const toEmails = emailMessage.to.map(addr => extractEmailAddress(addr.email));
      const ccEmails = emailMessage.cc?.map(addr => extractEmailAddress(addr.email));
      const fromEmail = extractEmailAddress(emailMessage.from.email);

      // Best-effort: publish queue event (should not block sending)
      try {
        await publishWorkflowEvent({
          eventType: 'OUTBOUND_EMAIL_QUEUED',
          payload: {
            messageId: workflowMessageId,
            ...(maybeThreadId ? { threadId: maybeThreadId } : {}),
            ...(maybeTicketId ? { ticketId: maybeTicketId } : {}),
            from: fromEmail,
            to: toEmails,
            ...(ccEmails?.length ? { cc: ccEmails } : {}),
            subject,
            queuedAt: new Date().toISOString(),
            provider: this.emailProvider.providerType,
          },
          ctx: {
            tenantId,
            correlationId: params.correlationId || workflowMessageId,
            actor: workflowActor,
          },
          idempotencyKey: `outbound_email:${workflowMessageId}:queued`,
        });
      } catch (publishError) {
        logger.warn(`[${this.getServiceName()}] Failed to publish OUTBOUND_EMAIL_QUEUED workflow event`, {
          error: publishError,
          tenantId,
          providerType: this.emailProvider.providerType,
        });
      }

      // Send via provider
      const result = await this.emailProvider.sendEmail(emailMessage, tenantId);

      if (result.success) {
        logger.info(`[${this.getServiceName()}] Email sent successfully:`, {
          messageId: result.messageId,
          to: emailMessage.to,
          subject
        });
      }

      // Best-effort: publish sent/failed event (should not affect send result)
      try {
        if (result.success) {
          await publishWorkflowEvent({
            eventType: 'OUTBOUND_EMAIL_SENT',
            payload: {
              messageId: workflowMessageId,
              providerMessageId:
                result.messageId || `${result.providerType}:${result.providerId}:${workflowMessageId}`,
              ...(maybeThreadId ? { threadId: maybeThreadId } : {}),
              ...(maybeTicketId ? { ticketId: maybeTicketId } : {}),
              sentAt: result.sentAt?.toISOString?.() || new Date().toISOString(),
              provider: result.providerType || this.emailProvider.providerType,
            },
            ctx: {
              tenantId,
              correlationId: params.correlationId || workflowMessageId,
              actor: workflowActor,
            },
            idempotencyKey: `outbound_email:${workflowMessageId}:sent`,
          });
        } else {
          await publishWorkflowEvent({
            eventType: 'OUTBOUND_EMAIL_FAILED',
            payload: {
              messageId: workflowMessageId,
              ...(maybeThreadId ? { threadId: maybeThreadId } : {}),
              ...(maybeTicketId ? { ticketId: maybeTicketId } : {}),
              failedAt: new Date().toISOString(),
              provider: result.providerType || this.emailProvider.providerType,
              errorMessage: result.error || 'Email send failed',
              ...(result.metadata?.errorCode ? { errorCode: String(result.metadata.errorCode) } : {}),
              ...(typeof result.metadata?.retryable === 'boolean'
                ? { retryable: result.metadata.retryable }
                : {}),
            },
            ctx: {
              tenantId,
              correlationId: params.correlationId || workflowMessageId,
              actor: workflowActor,
            },
            idempotencyKey: `outbound_email:${workflowMessageId}:failed`,
          });
        }
      } catch (publishError) {
        logger.warn(`[${this.getServiceName()}] Failed to publish outbound email workflow event`, {
          error: publishError,
          tenantId,
          providerType: this.emailProvider.providerType,
          providerId: this.emailProvider.providerId,
        });
      }

      // Convert provider result to our result format
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error
      };
    } catch (error) {
      logger.error(`[${this.getServiceName()}] Failed to send email:`, error);
      // Best-effort: publish failure for unexpected errors (do not alter response)
      try {
        const tenantId = params.tenantId || 'system';
        const workflowActor: WorkflowActor =
          params.workflowActor && typeof params.workflowActor === 'object'
            ? (params.workflowActor as WorkflowActor)
            : { actorType: 'SYSTEM' };
        const workflowMessageId = randomUUID();
        const maybeThreadId = isUuid(params.threadId) ? params.threadId : undefined;
        const maybeTicketId = isUuid(params.ticketId) ? params.ticketId : undefined;

        await publishWorkflowEvent({
          eventType: 'OUTBOUND_EMAIL_FAILED',
          payload: {
            messageId: workflowMessageId,
            ...(maybeThreadId ? { threadId: maybeThreadId } : {}),
            ...(maybeTicketId ? { ticketId: maybeTicketId } : {}),
            failedAt: new Date().toISOString(),
            provider: this.emailProvider?.providerType || 'unknown',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            ...(typeof (error as any)?.code === 'string' ? { errorCode: (error as any).code } : {}),
          },
          ctx: {
            tenantId,
            correlationId: params.correlationId || workflowMessageId,
            actor: workflowActor,
          },
          idempotencyKey: `outbound_email:${workflowMessageId}:failed_exception`,
        });
      } catch (publishError) {
        logger.warn(`[${this.getServiceName()}] Failed to publish OUTBOUND_EMAIL_FAILED workflow event`, {
          error: publishError,
        });
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
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
