/**
 * Resend Email Provider - Implements email sending via Resend.com API
 */

import axios, { AxiosInstance } from 'axios';
import logger from '@alga-psa/shared/core/logger';
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
} from '@shared/types/email';

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

interface ResendErrorResponse {
  message: string;
  name: string;
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
        logger.info(`[ResendEmailProvider:${this.providerId}] Sending email to ${message.to.map((t) => t.email).join(', ')} (attempt ${attempt + 1}/${maxRetries + 1})`);
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

  async createDomain(domain: string, region?: string): Promise<{ domainId: string; dnsRecords: DnsRecord[]; status: string }> {
    this.ensureInitialized();

    try {
      logger.info(`[ResendEmailProvider:${this.providerId}] Creating domain: ${domain}`);
      const response = await this.client!.post<ResendDomainResponse>('/domains', {
        name: domain,
        region: region || 'us-east-1',
      });

      logger.info(`[ResendEmailProvider:${this.providerId}] Domain created successfully:`, {
        id: response.data.id,
        status: response.data.status,
      });

      return {
        domainId: response.data.id,
        status: response.data.status,
        dnsRecords: this.transformResendRecords(response.data.records, response.data.name),
      };
    } catch (error: any) {
      const providerMessage: string | undefined = error.response?.data?.message;
      const statusCode = error.response?.status;
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to create domain:`, {
        error: error.response?.data || error.message,
        status: statusCode,
      });

      if (statusCode === 403 && providerMessage?.toLowerCase().includes('registered already')) {
        const existing = await this.findDomainByName(domain).catch(() => null);
        if (existing && existing.status !== 'verified') {
          logger.warn(
            `[ResendEmailProvider:${this.providerId}] Domain already exists with status ${existing.status}, returning existing DNS records`
          );
          return {
            domainId: existing.id,
            status: existing.status,
            dnsRecords: this.transformResendRecords(existing.records, existing.name),
          };
        }
      }

      const reason = providerMessage
        ? `Failed to create domain ${domain}: ${providerMessage}`
        : `Failed to create domain ${domain}`;
      throw this.createEmailError(reason, error);
    }
  }

  private async findDomainByName(domain: string): Promise<ResendDomainResponse | null> {
    try {
      const response = await this.client!.get<{ data: ResendDomainResponse[] }>('/domains');
      return response.data.data.find((entry) => entry.name.toLowerCase() === domain.toLowerCase()) ?? null;
    } catch (error) {
      logger.warn(`[ResendEmailProvider:${this.providerId}] Unable to fetch existing domains`, {
        error: (error as any)?.response?.data || (error as any)?.message || error,
      });
      return null;
    }
  }

  async verifyDomain(domainId: string): Promise<DomainVerificationResult> {
    this.ensureInitialized();

    try {
      logger.info(`[ResendEmailProvider:${this.providerId}] Verifying domain: ${domainId}`);
      const response = await this.client!.get<ResendDomainResponse>(`/domains/${domainId}`);

      logger.info(`[ResendEmailProvider:${this.providerId}] Domain verification result:`, {
        id: response.data.id,
        status: response.data.status,
      });

      return {
        domain: response.data.name,
        status: response.data.status,
        dnsRecords: this.transformResendRecords(response.data.records, response.data.name),
        providerId: this.providerId,
        verifiedAt: response.data.status === 'verified' ? new Date(response.data.created_at) : undefined,
      };
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to verify domain:`, {
        error: error.response?.data || error.message,
        status: error.response?.status,
      });
      throw this.createEmailError('Failed to verify domain', error);
    }
  }

  async startDomainVerification(domainId: string): Promise<DomainVerificationResult> {
    this.ensureInitialized();

    try {
      logger.info(`[ResendEmailProvider:${this.providerId}] Starting verification for domain: ${domainId}`);
      const response = await this.client!.post<ResendDomainResponse>(`/domains/${domainId}/verify`);

      logger.info(`[ResendEmailProvider:${this.providerId}] Provider verification started`, {
        id: response.data.id,
        status: response.data.status,
      });

      return {
        domain: response.data.name,
        status: response.data.status,
        dnsRecords: this.transformResendRecords(response.data.records, response.data.name),
        providerId: this.providerId,
        verifiedAt: response.data.status === 'verified' ? new Date(response.data.created_at) : undefined,
      };
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to start domain verification:`, {
        error: error.response?.data || error.message,
        status: error.response?.status,
      });
      throw this.createEmailError('Failed to start domain verification', error);
    }
  }

  async listDomains(): Promise<Array<{ domainId: string; domain: string; status: string; verifiedAt?: Date }>> {
    this.ensureInitialized();

    try {
      const response = await this.client!.get<{ data: ResendDomainResponse[] }>('/domains');
      return response.data.data.map((domain: ResendDomainResponse) => ({
        domainId: domain.id,
        domain: domain.name,
        status: domain.status,
        verifiedAt: domain.status === 'verified' ? new Date(domain.created_at) : undefined,
      }));
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to list domains:`, {
        error: error.response?.data || error.message,
        status: error.response?.status,
      });
      throw this.createEmailError('Failed to list domains', error);
    }
  }

  async deleteDomain(domainId: string): Promise<{ success: boolean }> {
    this.ensureInitialized();

    try {
      await this.client!.delete(`/domains/${domainId}`);
      logger.info(`[ResendEmailProvider:${this.providerId}] Domain deleted successfully: ${domainId}`);
      return { success: true };
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to delete domain:`, {
        error: error.response?.data || error.message,
        status: error.response?.status,
      });
      throw this.createEmailError('Failed to delete domain', error);
    }
  }

  private validateConfig(config: Record<string, any>): ResendConfig {
    const apiKey = config.apiKey || process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is required');
    }

    return {
      apiKey,
      baseUrl: config.baseUrl || process.env.RESEND_BASE_URL,
      defaultFromDomain: config.defaultFromDomain,
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.client || !this.config) {
      throw new Error('ResendEmailProvider is not initialized. Call initialize() first.');
    }
  }

  private createClient(): void {
    if (!this.config) {
      throw new Error('ResendEmailProvider configuration missing during client creation');
    }

    this.client = axios.create({
      baseURL: this.config.baseUrl || 'https://api.resend.com',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  private buildRequestPayload(message: EmailMessage): ResendEmailRequest {
    const fromAddress = message.from;
    const from = fromAddress.name ? `${fromAddress.name} <${fromAddress.email}>` : fromAddress.email;

    const payload: ResendEmailRequest = {
      from,
      to: message.to.map((recipient) => this.formatRecipient(recipient)),
      subject: message.subject,
      text: message.text,
      html: message.html,
    };

    if (message.cc && message.cc.length > 0) {
      payload.cc = message.cc.map((recipient) => this.formatRecipient(recipient));
    }

    if (message.bcc && message.bcc.length > 0) {
      payload.bcc = message.bcc.map((recipient) => this.formatRecipient(recipient));
    }

    if (message.replyTo) {
      payload.reply_to = [this.formatRecipient(message.replyTo)];
    }

    if (message.attachments && message.attachments.length > 0) {
      payload.attachments = message.attachments.map((attachment) => this.transformAttachment(attachment));
    }

    if (message.headers) {
      payload.headers = message.headers;
    }

    if (message.tags) {
      payload.tags = Object.entries(message.tags).map(([name, value]) => ({ name, value }));
    }

    return payload;
  }

  private formatRecipient(recipient: EmailAddress): string {
    return recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email;
  }

  private transformAttachment(attachment: EmailAttachment): {
    filename: string;
    content: string;
    content_type?: string;
  } {
    let content: string;
    if (typeof attachment.content === 'string' && /^data:/.test(attachment.content)) {
      const base64Match = attachment.content.match(/base64,(.*)$/);
      content = base64Match ? base64Match[1] : attachment.content;
    } else if (typeof attachment.content === 'string') {
      content = Buffer.from(attachment.content).toString('base64');
    } else {
      content = attachment.content.toString('base64');
    }

    return {
      filename: attachment.filename,
      content,
      content_type: attachment.contentType,
    };
  }

  private transformResendRecords(records: ResendDomainResponse['records'], domain?: string): DnsRecord[] {
    const suffix = domain?.toLowerCase().replace(/\.$/, '');
    return records.map((record) => ({
      type: record.type.toUpperCase() as DnsRecord['type'],
      name: this.ensureAbsoluteRecordName(record.name, suffix),
      value: record.value,
      ttl: record.ttl ? parseInt(record.ttl, 10) : undefined,
      priority: record.priority ? parseInt(record.priority, 10) : undefined,
    }));
  }

  private ensureAbsoluteRecordName(name: string, domain?: string): string {
    if (!domain) {
      return name;
    }

    const trimmed = (name || '').replace(/\.$/, '').trim();
    if (trimmed === '' || trimmed === '@') {
      return domain;
    }

    const lower = trimmed.toLowerCase();
    if (lower === domain || lower.endsWith(`.${domain}`)) {
      return trimmed;
    }

    return `${trimmed}.${domain}`;
  }

  private createEmailError(message: string, error: any): EmailProviderError {
    const resendError = error.response?.data as ResendErrorResponse | undefined;
    const metadata = {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: resendError?.message || error.response?.data,
    };
    const isRetryable = this.isRetryableError(error);
    return new EmailProviderError(message, this.providerId, this.providerType, isRetryable, resendError?.name, metadata);
  }

  private shouldRetry(error: any): boolean {
    return this.isRetryableError(error);
  }

  private isRetryableError(error: any): boolean {
    const status = error.response?.status;
    return status === 429 || (status && status >= 500);
  }

  private calculateBackoffDelay(attempt: number, baseDelay: number): number {
    const jitter = Math.random() * 100;
    return Math.min(30000, baseDelay * Math.pow(2, attempt)) + jitter;
  }

  private async verifyConnection(): Promise<void> {
    if (!this.config) {
      throw new Error('ResendEmailProvider configuration missing during connection verification');
    }

    const cacheKey = `${this.config.apiKey}:${this.config.baseUrl || 'default'}`;
    const cached = ResendEmailProvider.connectionVerified.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < ResendEmailProvider.VERIFICATION_CACHE_TTL) {
      logger.info(`[ResendEmailProvider:${this.providerId}] API connection verified (cached)`);
      return;
    }

    try {
      await axios.get('https://api.resend.com/domains', {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        timeout: 5000,
      });

      logger.info(`[ResendEmailProvider:${this.providerId}] API connection verified`);
      ResendEmailProvider.connectionVerified.set(cacheKey, {
        verified: true,
        timestamp: now,
      });
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] API verification failed:`, {
        error: error.response?.data || error.message,
        status: error.response?.status,
      });
      throw new EmailProviderError('Failed to verify Resend API connection', this.providerId, this.providerType, true);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
