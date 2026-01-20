/**
 * Resend Email Provider - Implements email sending via Resend.com API
 *
 * Copied from @alga-psa/integrations to avoid email → integrations cycles.
 */

import axios, { AxiosInstance } from 'axios';
import logger from '@alga-psa/core/logger';
import {
  IEmailProvider,
  EmailMessage,
  EmailSendResult,
  EmailProviderCapabilities,
  EmailProviderError,
  EmailAddress,
  EmailAttachment,
  DomainVerificationResult,
  DnsRecord,
} from '@alga-psa/types';

interface ResendConfig {
  apiKey: string;
  baseUrl?: string;
  defaultFromDomain?: string;
}

interface ResendEmailRequest {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    content_type?: string;
  }>;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
  reply_to?: string[];
}

interface ResendEmailResponse {
  id: string;
  from: string;
  to: string[];
  created_at: string;
}

interface ResendDomainResponse {
  id: string;
  name: string;
  status: 'pending' | 'verified' | 'failed';
  region: string;
  created_at: string;
  records: Array<{
    record: string;
    name: string;
    type: string;
    ttl?: string;
    priority?: string;
    value: string;
  }>;
}

export class ResendEmailProvider implements IEmailProvider {
  public readonly providerId: string;
  public readonly providerType = 'resend';
  public readonly capabilities: EmailProviderCapabilities = {
    supportsHtml: true,
    supportsAttachments: true,
    supportsTemplating: false,
    supportsBulkSending: true,
    supportsTracking: true,
    supportsCustomDomains: true,
    maxAttachmentSize: 40 * 1024 * 1024,
    maxRecipientsPerMessage: 50,
  };

  private client: AxiosInstance | null = null;
  private config: ResendConfig | null = null;
  private initialized = false;
  private static connectionVerified: Map<string, { verified: boolean; timestamp: number }> = new Map();
  private static readonly VERIFICATION_CACHE_TTL = 5 * 60 * 1000;

  constructor(providerId: string) {
    this.providerId = providerId;
    logger.info(`[ResendEmailProvider:${this.providerId}] Created Resend email provider`);
  }

  async initialize(config: Record<string, any>): Promise<void> {
    logger.info(`[ResendEmailProvider:${this.providerId}] Initializing Resend provider`);

    try {
      this.config = this.validateConfig(config);
      this.createClient();
      await this.verifyConnection();
      this.initialized = true;

      logger.info(`[ResendEmailProvider:${this.providerId}] Resend provider initialized successfully`);
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to initialize:`, {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });
      throw new EmailProviderError(
        `Resend initialization failed: ${error.message}`,
        this.providerId,
        this.providerType,
        false
      );
    }
  }

  async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
    this.ensureInitialized();

    const maxRetries = 3;
    const baseDelay = 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        logger.info(
          `[ResendEmailProvider:${this.providerId}] Sending email to ${message.to
            .map((t) => t.email)
            .join(', ')} (attempt ${attempt + 1}/${maxRetries + 1})`
        );
        const response = await this.client!.post<ResendEmailResponse>('/emails', this.buildRequestPayload(message));

        logger.info(`[ResendEmailProvider:${this.providerId}] Email sent successfully:`, {
          id: response.data.id,
          to: response.data.to,
          created_at: response.data.created_at,
        });

        return {
          success: true,
          messageId: response.data.id,
          providerId: this.providerId,
          providerType: this.providerType,
          metadata: {
            to: response.data.to,
            createdAt: response.data.created_at,
          },
          sentAt: new Date(response.data.created_at),
        };
      } catch (error: any) {
        logger.error(`[ResendEmailProvider:${this.providerId}] Failed to send email (attempt ${attempt + 1}):`, {
          error: error.response?.data || error.message,
          status: error.response?.status,
        });

        const shouldRetry = this.shouldRetry(error);
        if (!shouldRetry || attempt === maxRetries) {
          throw this.createEmailError('Failed to send email after multiple attempts', error);
        }

        const delay = this.calculateBackoffDelay(attempt, baseDelay);
        logger.info(`[ResendEmailProvider:${this.providerId}] Rate limit hit, retrying in ${delay}ms`);
        await this.delay(delay);
      }
    }

    throw new EmailProviderError('Failed to send email after retries', this.providerId, this.providerType, true);
  }

  async sendBulkEmails(messages: EmailMessage[]): Promise<EmailSendResult[]> {
    if (!Array.isArray(messages) || messages.length === 0) {
      return [];
    }

    logger.info(`[ResendEmailProvider:${this.providerId}] Sending ${messages.length} bulk emails`);

    const results: EmailSendResult[] = [];
    let successCount = 0;

    for (const message of messages) {
      try {
        const result = await this.sendEmail(message);
        results.push(result);
        successCount++;
      } catch (error: any) {
        logger.error(`[ResendEmailProvider:${this.providerId}] Bulk send failed:`, {
          error: error.response?.data || error.message,
          status: error.response?.status,
        });

        results.push({
          success: false,
          providerId: this.providerId,
          providerType: this.providerType,
          error: error.message,
          metadata: {
            to: message.to.map((recipient) => recipient.email),
          },
          sentAt: new Date(),
        });
      }
    }

    logger.info(`[ResendEmailProvider:${this.providerId}] Bulk send completed: ${successCount}/${messages.length} successful`);
    return results;
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
    try {
      await this.verifyConnection();
      return { healthy: true };
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Health check failed:`, {
        error: error.message,
        status: error.response?.status,
      });
      return {
        healthy: false,
        details: error.message,
      };
    }
  }

  async verifyDomain(domain: string): Promise<DomainVerificationResult> {
    this.ensureInitialized();

    try {
      const response = await this.client!.post<ResendDomainResponse>('/domains', { name: domain });

      const dnsRecords: DnsRecord[] = response.data.records.map((record) => ({
        type: record.type as DnsRecord['type'],
        name: record.name,
        value: record.value,
        ttl: record.ttl ? parseInt(record.ttl, 10) : undefined,
        priority: record.priority ? parseInt(record.priority, 10) : undefined,
      }));

      return {
        domain: response.data.name,
        status: response.data.status,
        dnsRecords,
        providerId: this.providerId,
        providerStatus: response.data.status,
        verifiedAt: response.data.status === 'verified' ? new Date(response.data.created_at) : undefined,
      };
    } catch (error: any) {
      throw this.createEmailError('Failed to verify domain', error);
    }
  }

  async getDomainStatus(domainId: string): Promise<DomainVerificationResult> {
    this.ensureInitialized();

    try {
      const response = await this.client!.get<ResendDomainResponse>(`/domains/${domainId}`);

      const dnsRecords: DnsRecord[] = response.data.records.map((record) => ({
        type: record.type as DnsRecord['type'],
        name: record.name,
        value: record.value,
        ttl: record.ttl ? parseInt(record.ttl, 10) : undefined,
        priority: record.priority ? parseInt(record.priority, 10) : undefined,
      }));

      return {
        domain: response.data.name,
        status: response.data.status,
        dnsRecords,
        providerId: this.providerId,
        providerStatus: response.data.status,
        verifiedAt: response.data.status === 'verified' ? new Date(response.data.created_at) : undefined,
      };
    } catch (error: any) {
      throw this.createEmailError('Failed to get domain status', error);
    }
  }

  private validateConfig(config: Record<string, any>): ResendConfig {
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid config object');
    }

    const apiKey = config.apiKey || config.api_key;
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('Resend API key is required');
    }

    return {
      apiKey,
      baseUrl: config.baseUrl || config.base_url || 'https://api.resend.com',
      defaultFromDomain: config.defaultFromDomain || config.default_from_domain,
    };
  }

  private createClient(): void {
    if (!this.config) {
      throw new Error('Config must be set before creating client');
    }

    this.client = axios.create({
      baseURL: this.config.baseUrl || 'https://api.resend.com',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  private async verifyConnection(): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('Client not initialized');
    }

    const cacheKey = this.providerId;
    const cached = ResendEmailProvider.connectionVerified.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ResendEmailProvider.VERIFICATION_CACHE_TTL) {
      if (!cached.verified) {
        throw new Error('Cached verification indicates connection failed');
      }
      return;
    }

    try {
      await this.client.get('/domains');
      ResendEmailProvider.connectionVerified.set(cacheKey, { verified: true, timestamp: Date.now() });
    } catch (error: any) {
      ResendEmailProvider.connectionVerified.set(cacheKey, { verified: false, timestamp: Date.now() });
      throw error;
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.client || !this.config) {
      throw new EmailProviderError('Provider not initialized', this.providerId, this.providerType, false);
    }
  }

  private buildRequestPayload(message: EmailMessage): ResendEmailRequest {
    const from = this.formatFromAddress(message.from);

    const payload: ResendEmailRequest = {
      from,
      to: message.to.map((recipient) => recipient.email),
      subject: message.subject,
    };

    if (message.cc?.length) payload.cc = message.cc.map((r) => r.email);
    if (message.bcc?.length) payload.bcc = message.bcc.map((r) => r.email);
    if (message.replyTo) payload.reply_to = [message.replyTo.email];

    if (message.text) payload.text = message.text;
    if (message.html) payload.html = message.html;

    if (message.attachments?.length) {
      payload.attachments = message.attachments.map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64'),
        content_type: a.contentType,
      }));
    }

    if (message.headers) payload.headers = message.headers;
    if (message.tags) payload.tags = Object.entries(message.tags).map(([name, value]) => ({ name, value }));

    return payload;
  }

  private formatFromAddress(from: EmailAddress): string {
    const email = from.email;
    const name = from.name;

    if (name && name.length > 0) {
      return `${name} <${email}>`;
    }

    // If caller didn't specify a from domain, allow a default domain to be set via config.
    if (this.config?.defaultFromDomain && !email.includes('@')) {
      return `${email}@${this.config.defaultFromDomain}`;
    }

    return email;
  }

  private shouldRetry(error: any): boolean {
    const status = error?.response?.status;
    if (!status) return false;
    return status === 429 || status >= 500;
  }

  private calculateBackoffDelay(attempt: number, baseDelay: number): number {
    return Math.min(baseDelay * Math.pow(2, attempt), 10000);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createEmailError(message: string, error: any): EmailProviderError {
    const status = error?.response?.status;
    const data = error?.response?.data as { message?: string } | undefined;
    const shouldRetry = this.shouldRetry(error);

    return new EmailProviderError(
      `${message}${status ? ` (status ${status})` : ''}${data?.message ? `: ${data.message}` : ''}`,
      this.providerId,
      this.providerType,
      shouldRetry
    );
  }
}
