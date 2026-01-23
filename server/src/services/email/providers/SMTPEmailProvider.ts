/**
 * SMTP Email Provider - Implements email sending via SMTP protocol
 */

import nodemailer from 'nodemailer';
import logger from '@alga-psa/core/logger';
import {
  IEmailProvider,
  EmailMessage,
  EmailSendResult,
  EmailProviderCapabilities,
  EmailProviderError,
  EmailAddress,
  EmailAttachment
} from '../../../types/email.types';

interface SMTPConfig {
  host: string;
  port: number;
  secure?: boolean; // true for 465, false for other ports
  username: string;
  password: string;
  from: string;
  rejectUnauthorized?: boolean;
  requireTLS?: boolean;
}

export class SMTPEmailProvider implements IEmailProvider {
  public readonly providerId: string;
  public readonly providerType = 'smtp';
  public readonly capabilities: EmailProviderCapabilities = {
    supportsHtml: true,
    supportsAttachments: true,
    supportsTemplating: false, // We handle templating at the manager level
    supportsBulkSending: false, // SMTP is typically one-by-one
    supportsTracking: false,
    supportsCustomDomains: true, // SMTP can send from any domain configured
    maxAttachmentSize: 25 * 1024 * 1024, // 25MB default
    maxRecipientsPerMessage: 100
  };

  private transporter: nodemailer.Transporter | null = null;
  private config: SMTPConfig | null = null;
  private initialized = false;

  constructor(providerId: string) {
    this.providerId = providerId;
    logger.info(`[SMTPEmailProvider:${this.providerId}] Created SMTP email provider`);
  }

  async initialize(config: Record<string, any>): Promise<void> {
    logger.info(`[SMTPEmailProvider:${this.providerId}] Initializing SMTP provider`);
    
    try {
      this.config = this.validateConfig(config);
      await this.createTransporter();
      this.initialized = true;
      
      logger.info(`[SMTPEmailProvider:${this.providerId}] SMTP provider initialized successfully`);
    } catch (error: any) {
      logger.error(`[SMTPEmailProvider:${this.providerId}] Failed to initialize:`, error);
      throw new EmailProviderError(
        `SMTP initialization failed: ${error.message}`,
        this.providerId,
        this.providerType,
        false,
        'INIT_FAILED'
      );
    }
  }

  async sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult> {
    if (!this.initialized || !this.transporter || !this.config) {
      throw new EmailProviderError(
        'SMTP provider not initialized',
        this.providerId,
        this.providerType,
        false,
        'NOT_INITIALIZED'
      );
    }

    try {
      logger.info(`[SMTPEmailProvider:${this.providerId}] Sending email to ${message.to.map(t => t.email).join(', ')}`);
      
      const mailOptions = this.buildMailOptions(message);
      const result = await this.transporter.sendMail(mailOptions);
      
      logger.info(`[SMTPEmailProvider:${this.providerId}] Email sent successfully:`, {
        messageId: result.messageId,
        response: result.response,
        tenantId
      });

      return {
        success: true,
        messageId: result.messageId,
        providerId: this.providerId,
        providerType: this.providerType,
        sentAt: new Date(),
        metadata: {
          response: result.response,
          envelope: result.envelope
        }
      };
    } catch (error: any) {
      logger.error(`[SMTPEmailProvider:${this.providerId}] Failed to send email:`, error);
      
      const isRetryable = this.isRetryableError(error);
      
      return {
        success: false,
        providerId: this.providerId,
        providerType: this.providerType,
        error: error.message,
        sentAt: new Date(),
        metadata: {
          errorCode: error.code,
          command: error.command,
          retryable: isRetryable
        }
      };
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
    if (!this.initialized || !this.transporter) {
      return {
        healthy: false,
        details: 'Provider not initialized'
      };
    }

    try {
      await this.transporter.verify();
      return {
        healthy: true,
        details: 'SMTP connection verified'
      };
    } catch (error: any) {
      logger.error(`[SMTPEmailProvider:${this.providerId}] Health check failed:`, error);
      return {
        healthy: false,
        details: `SMTP verification failed: ${error.message}`
      };
    }
  }

  async getRateLimitStatus(): Promise<{
    remaining: number;
    resetAt: Date;
    limit: number;
  }> {
    // SMTP servers typically don't have explicit rate limits exposed
    // Return a conservative estimate
    return {
      remaining: 1000,
      resetAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      limit: 1000
    };
  }

  private validateConfig(config: Record<string, any>): SMTPConfig {
    const requiredFields = ['host', 'port', 'username', 'password', 'from'];
    const missingFields = requiredFields.filter(field => !config[field]);
    
    if (missingFields.length > 0) {
      throw new Error(`Missing required SMTP configuration fields: ${missingFields.join(', ')}`);
    }

    // Validate port
    const port = parseInt(config.port?.toString() || '587', 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      throw new Error('Invalid SMTP port number');
    }

    return {
      host: config.host,
      port,
      secure: config.secure ?? (port === 465),
      username: config.username,
      password: config.password,
      from: config.from,
      rejectUnauthorized: config.rejectUnauthorized ?? true,
      requireTLS: config.requireTLS ?? false
    };
  }

  private async createTransporter(): Promise<void> {
    if (!this.config) {
      throw new Error('No configuration available');
    }

    const transportOptions: any = {
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user: this.config.username,
        pass: this.config.password
      },
      tls: {
        rejectUnauthorized: this.config.rejectUnauthorized
      }
    };

    if (this.config.requireTLS) {
      transportOptions.requireTLS = true;
    }

    this.transporter = nodemailer.createTransport(transportOptions);

    // Verify the connection
    try {
      await this.transporter?.verify();
      logger.info(`[SMTPEmailProvider:${this.providerId}] SMTP connection verified`);
    } catch (error: any) {
      logger.error(`[SMTPEmailProvider:${this.providerId}] SMTP verification failed:`, error);
      throw error;
    }
  }

  private buildMailOptions(message: EmailMessage): any {
    if (!this.config) {
      throw new Error('No configuration available');
    }

    const mailOptions: any = {
      from: this.formatAddress(message.from),
      to: message.to.map(addr => this.formatAddress(addr)).join(', '),
      subject: message.subject
    };

    if (message.cc && message.cc.length > 0) {
      mailOptions.cc = message.cc.map(addr => this.formatAddress(addr)).join(', ');
    }

    if (message.bcc && message.bcc.length > 0) {
      mailOptions.bcc = message.bcc.map(addr => this.formatAddress(addr)).join(', ');
    }

    if (message.replyTo) {
      mailOptions.replyTo = this.formatAddress(message.replyTo);
    }

    if (message.text) {
      mailOptions.text = message.text;
    }

    if (message.html) {
      mailOptions.html = message.html;
    }

    if (message.attachments && message.attachments.length > 0) {
      mailOptions.attachments = message.attachments.map(att => this.convertAttachment(att));
    }

    if (message.headers) {
      mailOptions.headers = message.headers;
    }

    return mailOptions;
  }

  private formatAddress(address: EmailAddress): string {
    if (address.name) {
      return `"${address.name}" <${address.email}>`;
    }
    return address.email;
  }

  private convertAttachment(attachment: EmailAttachment): any {
    const result: any = {
      filename: attachment.filename,
      content: attachment.content
    };

    if (attachment.contentType) {
      result.contentType = attachment.contentType;
    }

    if (attachment.cid) {
      result.cid = attachment.cid;
    }

    return result;
  }

  private isRetryableError(error: any): boolean {
    // Determine if the error is retryable based on SMTP error codes
    const retryableCodes = [
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EMFILE',
      'ENFILE',
      'ENOMEM'
    ];

    if (retryableCodes.includes(error.code)) {
      return true;
    }

    // Check SMTP response codes
    if (error.responseCode) {
      const code = parseInt(error.responseCode.toString(), 10);
      // 4xx codes are generally temporary failures
      if (code >= 400 && code < 500) {
        return true;
      }
    }

    return false;
  }
}