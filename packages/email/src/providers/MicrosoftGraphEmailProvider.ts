/**
 * Microsoft Graph outbound email provider.
 *
 * Wire-format conversion stays here; OAuth refresh and credential persistence
 * remain in the existing inbound MicrosoftGraphAdapter.
 */

import logger from '@alga-psa/core/logger';
import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import type {
  EmailAddress,
  EmailAttachment,
  EmailMessage,
  EmailProviderCapabilities,
  EmailSendResult,
  IEmailProvider,
} from '@alga-psa/types';
import { EmailProviderError } from '@alga-psa/types';
import {
  MicrosoftGraphAdapter,
  type MicrosoftGraphSendMailPayload,
} from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import type { EmailProviderConfig as InboundEmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const SIMPLE_ATTACHMENT_LIMIT = 3 * 1024 * 1024;

interface MicrosoftGraphConfig {
  inboundProvider: InboundEmailProviderConfig;
}

interface GraphRecipient {
  emailAddress: {
    address: string;
    name?: string;
  };
}

export class MicrosoftGraphEmailProvider implements IEmailProvider {
  public readonly providerId: string;
  public readonly providerType = 'microsoft';
  public readonly capabilities: EmailProviderCapabilities = {
    supportsHtml: true,
    supportsAttachments: true,
    supportsTemplating: false,
    supportsBulkSending: false,
    supportsTracking: false,
    supportsCustomDomains: false,
    maxAttachmentSize: SIMPLE_ATTACHMENT_LIMIT,
    maxRecipientsPerMessage: 500,
  };

  private adapter: MicrosoftGraphAdapter | null = null;
  private mailbox = '';
  private initialized = false;
  private readonly mimeTransport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'windows',
  });

  constructor(providerId: string) {
    this.providerId = providerId;
  }

  async initialize(config: Record<string, any>): Promise<void> {
    try {
      const validated = this.validateConfig(config);
      this.mailbox = validated.inboundProvider.mailbox.trim();
      this.assertMailSendConsent(validated.inboundProvider.provider_config?.access_token);
      this.adapter = new MicrosoftGraphAdapter(validated.inboundProvider);
      await this.adapter.connect();
      this.initialized = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MicrosoftGraphEmailProvider:${this.providerId}] Initialization failed`, {
        error: message,
      });
      throw new EmailProviderError(
        `Microsoft Graph initialization failed: ${message}`,
        this.providerId,
        this.providerType,
        false,
        'INIT_FAILED'
      );
    }
  }

  async sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult> {
    this.ensureInitialized();

    try {
      const payload = await this.buildSendPayload(message);
      const metadata = await this.adapter!.sendMail(payload);
      logger.info(`[MicrosoftGraphEmailProvider:${this.providerId}] Email accepted by Microsoft Graph`, {
        tenantId,
        mailbox: this.mailbox,
        requestId: metadata.requestId,
      });

      return {
        success: true,
        providerId: this.providerId,
        providerType: this.providerType,
        sentAt: new Date(),
        metadata,
      };
    } catch (error: any) {
      throw this.toProviderError(error);
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
    if (!this.initialized || !this.adapter) {
      return { healthy: false, details: 'Provider not initialized' };
    }

    try {
      const result = await this.adapter.testConnection();
      return result.success
        ? { healthy: true, details: `Microsoft Graph mailbox ${this.mailbox} is reachable` }
        : { healthy: false, details: result.error || 'Microsoft Graph connection test failed' };
    } catch (error) {
      return {
        healthy: false,
        details: error instanceof Error ? error.message : 'Microsoft Graph connection test failed',
      };
    }
  }

  private validateConfig(config: Record<string, any>): MicrosoftGraphConfig {
    const inboundProvider = config?.inboundProvider as InboundEmailProviderConfig | undefined;
    if (!inboundProvider?.id || inboundProvider.provider_type !== 'microsoft') {
      throw new Error('A Microsoft inbound email provider is required');
    }
    if (!inboundProvider.tenant) {
      throw new Error('Microsoft provider tenant is required');
    }
    if (!inboundProvider.mailbox?.trim()) {
      throw new Error('Microsoft sending mailbox is required');
    }

    const vendorConfig = inboundProvider.provider_config || {};
    if (!vendorConfig.access_token && !vendorConfig.refresh_token) {
      throw new Error('Microsoft OAuth tokens are missing. Reconnect the mailbox.');
    }

    return { inboundProvider };
  }

  private assertMailSendConsent(accessToken: unknown): void {
    if (typeof accessToken !== 'string') return;
    const payload = this.decodeJwtPayload(accessToken);
    if (!payload || typeof payload.scp !== 'string') return;

    const scopes = new Set(payload.scp.split(/\s+/).filter(Boolean));
    if (!scopes.has('Mail.Send')) {
      throw new Error('Microsoft Mail.Send consent is missing. Reconnect the mailbox and grant outbound mail permission.');
    }
  }

  private decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  private buildGraphMessage(message: EmailMessage): Record<string, unknown> {
    if (!message.to?.length) {
      throw new EmailProviderError(
        'At least one recipient is required',
        this.providerId,
        this.providerType,
        false,
        'INVALID_MESSAGE'
      );
    }

    const graphMessage: Record<string, unknown> = {
      subject: message.subject,
      body: {
        contentType: message.html ? 'HTML' : 'Text',
        content: message.html || message.text || '',
      },
      toRecipients: message.to.map(address => this.toRecipient(address)),
    };

    if (message.cc?.length) graphMessage.ccRecipients = message.cc.map(address => this.toRecipient(address));
    if (message.bcc?.length) graphMessage.bccRecipients = message.bcc.map(address => this.toRecipient(address));
    if (message.replyTo) graphMessage.replyTo = [this.toRecipient(message.replyTo)];
    if (message.headers && Object.keys(message.headers).length > 0) {
      graphMessage.internetMessageHeaders = Object.entries(message.headers).map(([name, value]) => ({ name, value }));
    }
    if (message.attachments?.length) {
      graphMessage.attachments = message.attachments.map(attachment => this.toAttachment(attachment));
    }

    return graphMessage;
  }

  private async buildSendPayload(message: EmailMessage): Promise<MicrosoftGraphSendMailPayload> {
    const headers = Object.keys(message.headers || {});
    const requiresMime = Boolean(message.from?.name?.trim())
      || headers.some(name => !name.toLowerCase().startsWith('x-'));

    if (!requiresMime) {
      return { kind: 'json', message: this.buildGraphMessage(message) };
    }

    const mime = await this.buildMimeMessage(message);
    return { kind: 'mime', content: mime.toString('base64') };
  }

  private async buildMimeMessage(message: EmailMessage): Promise<Buffer> {
    if (!message.to?.length) {
      throw new EmailProviderError(
        'At least one recipient is required',
        this.providerId,
        this.providerType,
        false,
        'INVALID_MESSAGE'
      );
    }

    const specialHeaders = this.extractSpecialHeaders(message.headers || {});
    const mail: Mail.Options = {
      from: {
        address: this.mailbox,
        name: message.from?.name || '',
      },
      to: message.to.map(address => ({ address: address.email, name: address.name || '' })),
      cc: message.cc?.map(address => ({ address: address.email, name: address.name || '' })),
      bcc: message.bcc?.map(address => ({ address: address.email, name: address.name || '' })),
      replyTo: message.replyTo
        ? { address: message.replyTo.email, name: message.replyTo.name || '' }
        : undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId: specialHeaders.messageId,
      inReplyTo: specialHeaders.inReplyTo,
      references: specialHeaders.references,
      headers: specialHeaders.remaining,
      attachments: message.attachments?.map(attachment => {
        const content = Buffer.isBuffer(attachment.content)
          ? attachment.content
          : Buffer.from(attachment.content);
        this.assertAttachmentSize(attachment.filename, content);
        return {
          filename: attachment.filename,
          content,
          contentType: attachment.contentType,
          cid: attachment.cid,
          contentDisposition: attachment.cid ? 'inline' as const : 'attachment' as const,
        };
      }),
    };

    const result = await this.mimeTransport.sendMail(mail);
    if (!Buffer.isBuffer(result.message)) {
      throw new Error('Microsoft Graph MIME compilation did not return a buffer');
    }
    return result.message;
  }

  private extractSpecialHeaders(headers: Record<string, string>): {
    messageId?: string;
    inReplyTo?: string;
    references?: string;
    remaining: Record<string, string>;
  } {
    const result: {
      messageId?: string;
      inReplyTo?: string;
      references?: string;
      remaining: Record<string, string>;
    } = { remaining: {} };

    for (const [name, value] of Object.entries(headers)) {
      switch (name.toLowerCase()) {
        case 'message-id':
          result.messageId = value;
          break;
        case 'in-reply-to':
          result.inReplyTo = value;
          break;
        case 'references':
          result.references = value;
          break;
        default:
          result.remaining[name] = value;
      }
    }

    return result;
  }

  private toRecipient(address: EmailAddress): GraphRecipient {
    return {
      emailAddress: {
        address: address.email,
        ...(address.name ? { name: address.name } : {}),
      },
    };
  }

  private toAttachment(attachment: EmailAttachment): Record<string, unknown> {
    const content = Buffer.isBuffer(attachment.content)
      ? attachment.content
      : Buffer.from(attachment.content);
    this.assertAttachmentSize(attachment.filename, content);

    return {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: attachment.filename,
      contentType: attachment.contentType || 'application/octet-stream',
      contentBytes: content.toString('base64'),
      ...(attachment.cid ? { contentId: attachment.cid, isInline: true } : {}),
    };
  }

  private assertAttachmentSize(filename: string, content: Buffer): void {
    if (content.byteLength <= SIMPLE_ATTACHMENT_LIMIT) return;

    throw new EmailProviderError(
      `Attachment ${filename} exceeds Microsoft Graph's 3 MB simple attachment limit`,
      this.providerId,
      this.providerType,
      false,
      'ATTACHMENT_TOO_LARGE'
    );
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.adapter) {
      throw new EmailProviderError(
        'Microsoft Graph provider not initialized',
        this.providerId,
        this.providerType,
        false,
        'NOT_INITIALIZED'
      );
    }
  }

  private toProviderError(error: any): EmailProviderError {
    if (error instanceof EmailProviderError) return error;

    const status = Number(error?.status || error?.response?.status || 0) || undefined;
    const code = String(error?.code || error?.response?.data?.error?.code || status || 'SEND_FAILED');
    const requestId = error?.requestId || error?.response?.headers?.['request-id'];
    const retryable = status === 429 || Boolean(status && status >= 500);

    let message = 'Microsoft Graph could not send the email.';
    if (status === 401) {
      message = 'Microsoft authorization expired. Reconnect the mailbox and try again.';
    } else if (status === 403) {
      message = 'Microsoft rejected the send. Reconnect to grant Mail.Send and verify Send As permission for the configured mailbox.';
    } else if (status === 429) {
      message = 'Microsoft Graph throttled the send. Try again later.';
    } else if (status && status >= 500) {
      message = 'Microsoft Graph is temporarily unavailable. Try again later.';
    }

    logger.error(`[MicrosoftGraphEmailProvider:${this.providerId}] Send failed`, {
      status,
      code,
      requestId,
      retryable,
    });

    return new EmailProviderError(
      message,
      this.providerId,
      this.providerType,
      retryable,
      code,
      { status, requestId }
    );
  }
}
