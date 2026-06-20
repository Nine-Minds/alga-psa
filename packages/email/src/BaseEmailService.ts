import logger from '@alga-psa/core/logger';
import { createHash, randomUUID } from 'node:crypto';
import {
  IEmailProvider,
  EmailMessage as ProviderEmailMessage,
  EmailSendResult as ProviderEmailSendResult,
  EmailAddress as ProviderEmailAddress
} from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { publishWorkflowEvent, type WorkflowActor } from '@alga-psa/event-bus/publishers';
import { SupportedLocale } from './lib/localeConfig';

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
  providerMessageId?: string;
  rfcMessageId?: string;
  error?: string;
  queued?: boolean;      // true if queued for later delivery due to rate limiting
  retryCount?: number;   // current retry attempt (0 = first attempt)
  providerId?: string;
  providerType?: string;
  metadata?: Record<string, any>;
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
  replyContext?: {
    ticketId?: string;
    projectId?: string;
    commentId?: string;
    threadId?: string;
    conversationToken?: string;
  };
  // Allow subclasses to add their own parameters
  [key: string]: any;
}

const REPLY_TOKEN_SUFFIX_LENGTH = 8;

function getReplyTokenFingerprint(token?: string): {
  replyTokenHash: string | null;
  replyTokenSuffix: string | null;
} {
  const trimmedToken = typeof token === 'string' ? token.trim() : '';
  if (!trimmedToken) {
    return {
      replyTokenHash: null,
      replyTokenSuffix: null,
    };
  }

  return {
    replyTokenHash: createHash('sha256').update(trimmedToken).digest('hex'),
    replyTokenSuffix: trimmedToken.slice(-REPLY_TOKEN_SUFFIX_LENGTH),
  };
}

function getMetadataString(
  metadata: Record<string, any> | undefined,
  keys: string[]
): string | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function normalizeHeaderValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function getHeaderValue(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) {
    return null;
  }

  const lowerName = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === lowerName);
  return key ? normalizeHeaderValue(headers[key]) : null;
}

interface CommentThreadReplyHeaderContext {
  commentThreadId: string;
  references: string[];
}

function extractDomainFromAddress(address?: string): string | null {
  if (typeof address !== 'string') return null;
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  const domain = address.slice(at + 1).trim().replace(/>+$/, '').trim();
  return domain || null;
}

function buildGeneratedRfcMessageId(domain?: string | null): string {
  const domainPart = (domain && domain.trim()) || 'alga-psa.local';
  return `<${randomUUID()}@${domainPart}>`;
}

const TICKET_REFERENCES_CAP = 20;

// Keep the root anchor first, then at most `max` most-recent ids, so the
// References header stays bounded while always preserving the thread root.
export function capReferences(references: string[], root: string, max = TICKET_REFERENCES_CAP): string[] {
  const rest = references.filter((value) => value !== root);
  return rest.length <= max ? [root, ...rest] : [root, ...rest.slice(-max)];
}

/**
 * Pure builder for a ticket email's threading headers. Given the conversation
 * root and the prior outbound message-ids (oldest→newest), returns the
 * In-Reply-To (most recent prior id, else the root) and the deduped, root-first,
 * capped References chain. Exported for unit testing.
 */
export function buildTicketThreadHeaders(
  root: string,
  priorReferences: string[],
  max = TICKET_REFERENCES_CAP
): { inReplyTo: string; references: string[] } {
  const prior = dedupeHeaderValues(priorReferences);
  const lastPrior = [...prior].reverse().find((id) => id && id !== root) ?? null;
  const references = capReferences(dedupeHeaderValues([root, ...prior]), root, max);
  return { inReplyTo: lastPrior ?? root, references };
}

function dedupeHeaderValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = normalizeHeaderValue(value ?? undefined);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
}

async function addCommentThreadReplyHeaders(params: {
  tenantId?: string;
  commentId?: string;
  headers: Record<string, string>;
  serviceName: string;
}): Promise<CommentThreadReplyHeaderContext | null> {
  if (!params.tenantId || !params.commentId) {
    return null;
  }

  try {
    const { knex } = await createTenantKnex(params.tenantId);
    const comment = await knex('comments')
      .select('thread_id', 'parent_comment_id')
      .where({
        tenant: params.tenantId,
        comment_id: params.commentId,
      })
      .first<{ thread_id?: string | null; parent_comment_id?: string | null }>();

    if (!comment?.thread_id || !comment.parent_comment_id) {
      return null;
    }

    const [latestOutbound, thread] = await Promise.all([
      knex('email_sending_logs')
        .select('rfc_message_id')
        .where({
          tenant: params.tenantId,
          comment_thread_id: comment.thread_id,
          status: 'sent',
        })
        .whereNotNull('rfc_message_id')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .first<{ rfc_message_id?: string | null }>(),
      knex('comment_threads')
        .select('email_references')
        .where({
          tenant: params.tenantId,
          thread_id: comment.thread_id,
        })
        .first<{ email_references?: string[] | string | null }>(),
    ]);

    const inReplyTo = normalizeHeaderValue(latestOutbound?.rfc_message_id ?? undefined);
    if (!inReplyTo) {
      return null;
    }

    const storedReferences = Array.isArray(thread?.email_references)
      ? thread.email_references
      : [];
    const references = dedupeHeaderValues([...storedReferences, inReplyTo]);

    params.headers['In-Reply-To'] = inReplyTo;
    if (references.length > 0) {
      params.headers.References = references.join(' ');
    }

    return {
      commentThreadId: comment.thread_id,
      references,
    };
  } catch (error) {
    logger.warn(`[${params.serviceName}] Failed to resolve comment thread reply headers`, {
      tenantId: params.tenantId,
      commentId: params.commentId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

async function persistCommentThreadReferences(params: {
  tenantId?: string;
  context: CommentThreadReplyHeaderContext | null;
  serviceName: string;
}): Promise<void> {
  if (!params.tenantId || !params.context || params.context.references.length === 0) {
    return;
  }

  try {
    const { knex } = await createTenantKnex(params.tenantId);
    await knex('comment_threads')
      .where({
        tenant: params.tenantId,
        thread_id: params.context.commentThreadId,
      })
      .update({
        email_references: params.context.references,
      });
  } catch (error) {
    logger.warn(`[${params.serviceName}] Failed to persist comment thread references`, {
      tenantId: params.tenantId,
      commentThreadId: params.context.commentThreadId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Apply ticket-scoped RFC threading headers to ANY outbound ticket email
 * (created/updated/closed/assigned/comment), so every notification for a ticket
 * collapses into a single conversation in the recipient's mail client.
 *
 * The anchor (root Message-ID) is the customer's original inbound Message-ID for
 * email-origin tickets (so agent replies merge into their existing thread), or a
 * deterministic synthetic `<ticket-{id}@{domain}>` for UI-origin tickets, persisted
 * once to `tickets.email_metadata.threadRoot`. In-Reply-To points at the most recent
 * prior outbound id (or the root); References accumulates the chain, capped.
 *
 * Best-effort: any failure is logged and never blocks the send.
 */
async function applyTicketThreadHeaders(params: {
  tenantId?: string;
  ticketId?: string;
  fromDomain?: string | null;
  headers: Record<string, string>;
  serviceName: string;
}): Promise<void> {
  if (!params.tenantId || !params.ticketId) {
    return;
  }

  try {
    const { knex } = await createTenantKnex(params.tenantId);
    const ticket = await knex('tickets')
      .select('email_metadata')
      .where({ tenant: params.tenantId, ticket_id: params.ticketId })
      .first<{ email_metadata?: Record<string, any> | null }>();

    const meta = ticket?.email_metadata && typeof ticket.email_metadata === 'object'
      ? (ticket.email_metadata as Record<string, any>)
      : {};

    // Resolve (and persist if needed) the canonical per-ticket root Message-ID.
    let root = normalizeHeaderValue(meta.messageId) ?? normalizeHeaderValue(meta.threadRoot);
    if (!root) {
      const domain = (params.fromDomain && params.fromDomain.trim()) || 'alga-psa.local';
      root = `<ticket-${params.ticketId}@${domain}>`;
      // Deterministic value → concurrent first-events converge on the same anchor.
      await knex('tickets')
        .where({ tenant: params.tenantId, ticket_id: params.ticketId })
        .update({
          email_metadata: knex.raw(
            `jsonb_set(COALESCE(email_metadata, '{}'::jsonb), '{threadRoot}', to_jsonb(?::text), true)`,
            [root]
          ),
        });
    }

    const priorReferences = Array.isArray(meta.references) ? meta.references : [];
    const { inReplyTo, references } = buildTicketThreadHeaders(root, priorReferences);

    params.headers['In-Reply-To'] = inReplyTo;
    if (references.length > 0) {
      params.headers.References = references.join(' ');
    }
  } catch (error) {
    logger.warn(`[${params.serviceName}] Failed to apply ticket thread headers`, {
      tenantId: params.tenantId,
      ticketId: params.ticketId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

function deriveOutboundMessageIds(result: ProviderEmailSendResult, message?: ProviderEmailMessage): {
  providerMessageId: string | null;
  rfcMessageId: string | null;
} {
  const providerMessageId =
    result.providerMessageId ??
    getMetadataString(result.metadata, ['providerMessageId', 'provider_message_id']) ??
    result.messageId ??
    null;

  const rfcMessageId =
    result.rfcMessageId ??
    getMetadataString(result.metadata, [
      'rfcMessageId',
      'rfc_message_id',
      'messageIdHeader',
      'message_id_header',
    ]) ??
    getHeaderValue(message?.headers, 'Message-ID') ??
    (result.messageId && /@/.test(result.messageId) ? result.messageId : null);

  return {
    providerMessageId,
    rfcMessageId,
  };
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
      
      const headers = { ...(params.headers ?? {}) };
      const fromDomain = extractDomainFromAddress(from.email);
      // A ticket email is any email associated with a ticket — via replyContext or the
      // entity association (bundle child notifications use the latter).
      const effectiveTicketId = params.replyContext?.ticketId
        ?? (params.entityType === 'ticket' ? params.entityId : undefined);

      let commentThreadHeaderContext: CommentThreadReplyHeaderContext | null = null;
      if (effectiveTicketId) {
        // Ticket-scoped threading: every ticket email shares one per-ticket anchor.
        await applyTicketThreadHeaders({
          tenantId: params.tenantId,
          ticketId: effectiveTicketId,
          fromDomain,
          headers,
          serviceName: this.getServiceName(),
        });
      } else {
        // Non-ticket comment threads keep their existing comment-scoped behavior.
        commentThreadHeaderContext = await addCommentThreadReplyHeaders({
          tenantId: params.tenantId,
          commentId: params.replyContext?.commentId,
          headers,
          serviceName: this.getServiceName(),
        });
      }

      // Always stamp a Message-ID we control for ticket/comment emails so the recorded
      // rfc_message_id matches the wire and later emails can reference it.
      if ((effectiveTicketId || params.replyContext?.commentId) && !getHeaderValue(headers, 'Message-ID')) {
        headers['Message-ID'] = buildGeneratedRfcMessageId(fromDomain);
      }

      const effectiveEntityType = params.entityType ?? (effectiveTicketId ? 'ticket' : undefined);
      const effectiveEntityId = params.entityId ?? effectiveTicketId;

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
        headers
      };

      // Outbound email lifecycle workflow events (F071). Best-effort: publishing
      // must never block or fail the actual send.
      const tenantId = params.tenantId || 'system';
      const workflowMessageId = randomUUID();
      const workflowActor: WorkflowActor =
        params.workflowActor && typeof params.workflowActor === 'object'
          ? (params.workflowActor as WorkflowActor)
          : { actorType: 'SYSTEM' };
      const maybeThreadId = isUuid(params.replyContext?.threadId) ? params.replyContext?.threadId : undefined;
      const maybeTicketId = isUuid(params.replyContext?.ticketId) ? params.replyContext?.ticketId : undefined;
      const fromEmail = extractEmailAddress(emailMessage.from.email);
      const toEmails = emailMessage.to.map(addr => extractEmailAddress(addr.email));
      const ccEmails = emailMessage.cc?.map(addr => extractEmailAddress(addr.email));
      const workflowCtx = {
        tenantId,
        correlationId: params.correlationId || workflowMessageId,
        actor: workflowActor,
      };

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
          ctx: workflowCtx,
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
      const result = await this.emailProvider.sendEmail(emailMessage, params.tenantId || 'system');

      // Best-effort: persist provider-level send result for auditing/debugging.
      void this.logEmailSendResult({
        tenantId: typeof params.tenantId === 'string' ? params.tenantId : null,
        providerResult: result,
        message: emailMessage,
        entityType: effectiveEntityType,
        entityId: effectiveEntityId,
        contactId: params.contactId,
        notificationSubtypeId: params.notificationSubtypeId,
        replyContext: params.replyContext,
      });

      if (result.success) {
        await persistCommentThreadReferences({
          tenantId: params.tenantId,
          context: commentThreadHeaderContext,
          serviceName: this.getServiceName(),
        });

        logger.info(`[${this.getServiceName()}] Email sent successfully:`, {
          messageId: result.messageId,
          to: emailMessage.to,
          subject
        });
      }

      // Best-effort: publish sent/failed lifecycle event (must not affect send result).
      try {
        if (result.success) {
          await publishWorkflowEvent({
            eventType: 'OUTBOUND_EMAIL_SENT',
            payload: {
              messageId: workflowMessageId,
              providerMessageId:
                result.providerMessageId || result.messageId || `${result.providerType}:${result.providerId}:${workflowMessageId}`,
              ...(maybeThreadId ? { threadId: maybeThreadId } : {}),
              ...(maybeTicketId ? { ticketId: maybeTicketId } : {}),
              sentAt: result.sentAt?.toISOString?.() || new Date().toISOString(),
              provider: result.providerType || this.emailProvider.providerType,
            },
            ctx: workflowCtx,
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
              ...(typeof result.metadata?.retryable === 'boolean' ? { retryable: result.metadata.retryable } : {}),
            },
            ctx: workflowCtx,
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
        providerMessageId: result.providerMessageId,
        rfcMessageId: result.rfcMessageId ?? getHeaderValue(emailMessage.headers, 'Message-ID') ?? undefined,
        error: result.error,
        providerId: result.providerId,
        providerType: result.providerType,
        metadata: result.metadata
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
          replyContext: params.replyContext,
        });
      }

      logger.error(`[${this.getServiceName()}] Failed to send email:`, error);

      // Best-effort: emit a FAILED lifecycle event for unexpected errors too.
      try {
        const failureMessageId = randomUUID();
        const failureTenantId = params.tenantId || 'system';
        await publishWorkflowEvent({
          eventType: 'OUTBOUND_EMAIL_FAILED',
          payload: {
            messageId: failureMessageId,
            ...(isUuid(params.replyContext?.threadId) ? { threadId: params.replyContext?.threadId } : {}),
            ...(isUuid(params.replyContext?.ticketId) ? { ticketId: params.replyContext?.ticketId } : {}),
            failedAt: new Date().toISOString(),
            provider: this.emailProvider?.providerType || 'unknown',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            ...(typeof (error as any)?.code === 'string' ? { errorCode: (error as any).code } : {}),
          },
          ctx: {
            tenantId: failureTenantId,
            correlationId: params.correlationId || failureMessageId,
            actor:
              params.workflowActor && typeof params.workflowActor === 'object'
                ? (params.workflowActor as WorkflowActor)
                : { actorType: 'SYSTEM' },
          },
          idempotencyKey: `outbound_email:${failureMessageId}:failed_exception`,
        });
      } catch (publishError) {
        logger.warn(`[${this.getServiceName()}] Failed to publish OUTBOUND_EMAIL_FAILED workflow event`, {
          error: publishError,
        });
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        providerId: this.emailProvider?.providerId,
        providerType: this.emailProvider?.providerType
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
    replyContext?: BaseEmailParams['replyContext'];
  }): Promise<void> {
    if (!params.tenantId) return;

    try {
      const { knex } = await createTenantKnex(params.tenantId);

      const toAddresses = params.message.to.map((addr) => addr.email);
      const ccAddresses = params.message.cc?.map((addr) => addr.email) ?? null;
      const bccAddresses = params.message.bcc?.map((addr) => addr.email) ?? null;
      const { providerMessageId, rfcMessageId } = deriveOutboundMessageIds(params.providerResult, params.message);
      const { replyTokenHash, replyTokenSuffix } = getReplyTokenFingerprint(
        params.replyContext?.conversationToken
      );
      const comment = params.replyContext?.commentId
        ? await knex('comments')
          .select('thread_id', 'parent_comment_id')
          .where({
            tenant: params.tenantId,
            comment_id: params.replyContext.commentId,
          })
          .first<{ thread_id?: string | null; parent_comment_id?: string | null }>()
        : null;
      const commentThreadId = comment?.thread_id ?? null;
      const baseMetadata =
        params.providerResult.metadata && typeof params.providerResult.metadata === 'object'
          ? { ...params.providerResult.metadata }
          : {};
      const existingDiagnostics =
        baseMetadata.algaDiagnostics && typeof baseMetadata.algaDiagnostics === 'object'
          ? baseMetadata.algaDiagnostics
          : {};
      const metadata = {
        ...baseMetadata,
        algaDiagnostics: {
          ...existingDiagnostics,
          outbound: {
            providerMessageId,
            rfcMessageId,
            threadId: params.replyContext?.threadId ?? null,
            commentThreadId,
            ticketId: params.replyContext?.ticketId ?? null,
            projectId: params.replyContext?.projectId ?? null,
            commentId: params.replyContext?.commentId ?? null,
            replyTokenPresent: Boolean(params.replyContext?.conversationToken),
            replyTokenHash,
            replyTokenSuffix,
          },
        },
      };

      await knex(BaseEmailService.EMAIL_LOG_TABLE).insert({
        tenant: params.tenantId,
        message_id: params.providerResult.messageId ?? null,
        provider_message_id: providerMessageId,
        rfc_message_id: rfcMessageId,
        provider_id: params.providerResult.providerId,
        provider_type: params.providerResult.providerType,
        from_address: params.message.from.email,
        to_addresses: JSON.stringify(toAddresses),
        cc_addresses: ccAddresses ? JSON.stringify(ccAddresses) : null,
        bcc_addresses: bccAddresses ? JSON.stringify(bccAddresses) : null,
        subject: params.message.subject,
        status: params.providerResult.success ? 'sent' : 'failed',
        error_message: params.providerResult.error ?? null,
        metadata,
        sent_at: params.providerResult.sentAt ?? new Date(),
        entity_type: params.entityType ?? null,
        entity_id: params.entityId ?? null,
        contact_id: params.contactId ?? null,
        notification_subtype_id: params.notificationSubtypeId ?? null,
        thread_id: params.replyContext?.threadId ?? null,
        comment_thread_id: commentThreadId,
        comment_id: params.replyContext?.commentId ?? null,
        reply_token_hash: replyTokenHash,
        reply_token_suffix: replyTokenSuffix,
      });

      if (params.providerResult.success && params.replyContext?.commentId && rfcMessageId) {
        if (comment?.thread_id && !comment.parent_comment_id) {
          await knex('comment_threads')
            .where({
              tenant: params.tenantId,
              thread_id: comment.thread_id,
            })
            .update({
              email_message_id: rfcMessageId,
              email_provider_thread_id: params.replyContext.threadId ?? null,
            });
        }
      }
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
