/**
 * Resend Email Provider - Implements email sending via Resend.com API
 */

import axios, { AxiosInstance } from 'axios';
import logger from '@shared/core/logger.js';
import {
  IEmailProvider,
  EmailMessage,
  EmailSendResult,
  EmailProviderCapabilities,
  EmailProviderError,
  EmailAddress,
  EmailAttachment,
  DomainVerificationResult,
  DnsRecord
} from '../../../types/email.types.js';

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
    content: string; // base64 encoded
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
    supportsTemplating: false, // We handle templating at the manager level
    supportsBulkSending: true,
    supportsTracking: true,
    supportsCustomDomains: true,
    maxAttachmentSize: 40 * 1024 * 1024, // 40MB for Resend
    maxRecipientsPerMessage: 50 // Resend's limit
  };

  private client: AxiosInstance | null = null;
  private config: ResendConfig | null = null;
  private initialized = false;

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
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to initialize:`, error);
      throw new EmailProviderError(
        `Resend initialization failed: ${error.message}`,
        this.providerId,
        this.providerType,
        false,
        'INIT_FAILED'
      );
    }
  }

  async sendEmail(message: EmailMessage, tenantId: string): Promise<EmailSendResult> {
    if (!this.initialized || !this.client || !this.config) {
      throw new EmailProviderError(
        'Resend provider not initialized',
        this.providerId,
        this.providerType,
        false,
        'NOT_INITIALIZED'
      );
    }

    try {
      logger.info(`[ResendEmailProvider:${this.providerId}] Sending email to ${message.to.map(t => t.email).join(', ')}`);
      
      const emailRequest = this.buildEmailRequest(message);
      const response = await this.client.post<ResendEmailResponse>('/emails', emailRequest);
      
      logger.info(`[ResendEmailProvider:${this.providerId}] Email sent successfully:`, {
        messageId: response.data.id,
        tenantId
      });

      return {
        success: true,
        messageId: response.data.id,
        providerId: this.providerId,
        providerType: this.providerType,
        sentAt: new Date(response.data.created_at),
        metadata: {
          resendId: response.data.id,
          from: response.data.from,
          to: response.data.to
        }
      };
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to send email:`, error);
      
      const resendError = this.parseResendError(error);
      const isRetryable = this.isRetryableError(error);
      
      return {
        success: false,
        providerId: this.providerId,
        providerType: this.providerType,
        error: resendError.message,
        sentAt: new Date(),
        metadata: {
          errorName: resendError.name,
          statusCode: error.response?.status,
          retryable: isRetryable
        }
      };
    }
  }

  async sendBulkEmails(messages: EmailMessage[], tenantId: string): Promise<EmailSendResult[]> {
    if (!this.initialized || !this.client || !this.config) {
      throw new EmailProviderError(
        'Resend provider not initialized',
        this.providerId,
        this.providerType,
        false,
        'NOT_INITIALIZED'
      );
    }

    logger.info(`[ResendEmailProvider:${this.providerId}] Sending ${messages.length} bulk emails`);
    
    // Resend doesn't have a dedicated bulk API, so we'll send in parallel batches
    const batchSize = 10; // Reasonable batch size to avoid overwhelming the API
    const results: EmailSendResult[] = [];
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const batchPromises = batch.map(message => this.sendEmail(message, tenantId));
      
      try {
        const batchResults = await Promise.allSettled(batchPromises);
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push({
              success: false,
              providerId: this.providerId,
              providerType: this.providerType,
              error: result.reason?.message || 'Unknown error',
              sentAt: new Date()
            });
          }
        }
      } catch (error: any) {
        logger.error(`[ResendEmailProvider:${this.providerId}] Batch send failed:`, error);
        
        // Add failed results for this batch
        for (let j = 0; j < batch.length; j++) {
          results.push({
            success: false,
            providerId: this.providerId,
            providerType: this.providerType,
            error: error.message,
            sentAt: new Date()
          });
        }
      }
      
      // Small delay between batches to be respectful of rate limits
      if (i + batchSize < messages.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    logger.info(`[ResendEmailProvider:${this.providerId}] Bulk send completed: ${successCount}/${messages.length} successful`);
    
    return results;
  }

  async healthCheck(): Promise<{ healthy: boolean; details?: string }> {
    if (!this.initialized || !this.client) {
      return {
        healthy: false,
        details: 'Provider not initialized'
      };
    }

    try {
      // Use the domains endpoint as a health check
      await this.client.get('/domains');
      return {
        healthy: true,
        details: 'Resend API connection successful'
      };
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Health check failed:`, error);
      return {
        healthy: false,
        details: `Resend API error: ${error.message}`
      };
    }
  }

  async getRateLimitStatus(): Promise<{
    remaining: number;
    resetAt: Date;
    limit: number;
  }> {
    // Resend includes rate limit headers in responses
    // For now, return conservative estimates
    return {
      remaining: 1000,
      resetAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      limit: 1000
    };
  }

  // Domain management methods
  async createDomain(domain: string, region = 'us-east-1'): Promise<{
    domainId: string;
    dnsRecords: DnsRecord[];
    status: string;
  }> {
    if (!this.initialized || !this.client) {
      throw new EmailProviderError(
        'Resend provider not initialized',
        this.providerId,
        this.providerType,
        false,
        'NOT_INITIALIZED'
      );
    }

    try {
      logger.info(`[ResendEmailProvider:${this.providerId}] Creating domain: ${domain}`);
      
      const response = await this.client.post<ResendDomainResponse>('/domains', {
        name: domain,
        region
      });

      const dnsRecords: DnsRecord[] = response.data.records.map(record => ({
        type: record.type as 'TXT' | 'MX' | 'CNAME' | 'A',
        name: record.name,
        value: record.value,
        ttl: record.ttl ? parseInt(record.ttl, 10) : undefined,
        priority: record.priority ? parseInt(record.priority, 10) : undefined
      }));

      logger.info(`[ResendEmailProvider:${this.providerId}] Domain created successfully:`, {
        domainId: response.data.id,
        domain: response.data.name,
        status: response.data.status
      });

      return {
        domainId: response.data.id,
        dnsRecords,
        status: response.data.status
      };
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to create domain:`, error);
      throw new EmailProviderError(
        `Failed to create domain: ${error.message}`,
        this.providerId,
        this.providerType,
        this.isRetryableError(error),
        'DOMAIN_CREATE_FAILED'
      );
    }
  }

  async verifyDomain(domainId: string): Promise<DomainVerificationResult> {
    if (!this.initialized || !this.client) {
      throw new EmailProviderError(
        'Resend provider not initialized',
        this.providerId,
        this.providerType,
        false,
        'NOT_INITIALIZED'
      );
    }

    try {
      logger.info(`[ResendEmailProvider:${this.providerId}] Verifying domain: ${domainId}`);
      
      // First trigger verification
      await this.client.post(`/domains/${domainId}/verify`);
      
      // Then get the updated status
      const response = await this.client.get<ResendDomainResponse>(`/domains/${domainId}`);
      
      const result: DomainVerificationResult = {
        domain: response.data.name,
        status: response.data.status,
        providerId: this.providerId
      };

      if (response.data.status === 'verified') {
        result.verifiedAt = new Date(response.data.created_at);
      }

      if (response.data.records) {
        result.dnsRecords = response.data.records.map(record => ({
          type: record.type as 'TXT' | 'MX' | 'CNAME' | 'A',
          name: record.name,
          value: record.value,
          ttl: record.ttl ? parseInt(record.ttl, 10) : undefined,
          priority: record.priority ? parseInt(record.priority, 10) : undefined
        }));
      }

      logger.info(`[ResendEmailProvider:${this.providerId}] Domain verification result:`, {
        domain: result.domain,
        status: result.status
      });

      return result;
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to verify domain:`, error);
      
      return {
        domain: 'unknown',
        status: 'failed',
        failureReason: error.message,
        providerId: this.providerId
      };
    }
  }

  async listDomains(): Promise<Array<{
    domainId: string;
    domain: string;
    status: string;
    verifiedAt?: Date;
  }>> {
    if (!this.initialized || !this.client) {
      throw new EmailProviderError(
        'Resend provider not initialized',
        this.providerId,
        this.providerType,
        false,
        'NOT_INITIALIZED'
      );
    }

    try {
      const response = await this.client.get<{ data: ResendDomainResponse[] }>('/domains');
      
      return response.data.data.map(domain => ({
        domainId: domain.id,
        domain: domain.name,
        status: domain.status,
        verifiedAt: domain.status === 'verified' ? new Date(domain.created_at) : undefined
      }));
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to list domains:`, error);
      throw new EmailProviderError(
        `Failed to list domains: ${error.message}`,
        this.providerId,
        this.providerType,
        this.isRetryableError(error),
        'DOMAIN_LIST_FAILED'
      );
    }
  }

  async deleteDomain(domainId: string): Promise<{ success: boolean }> {
    if (!this.initialized || !this.client) {
      throw new EmailProviderError(
        'Resend provider not initialized',
        this.providerId,
        this.providerType,
        false,
        'NOT_INITIALIZED'
      );
    }

    try {
      await this.client.delete(`/domains/${domainId}`);
      logger.info(`[ResendEmailProvider:${this.providerId}] Domain deleted successfully: ${domainId}`);
      return { success: true };
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] Failed to delete domain:`, error);
      throw new EmailProviderError(
        `Failed to delete domain: ${error.message}`,
        this.providerId,
        this.providerType,
        this.isRetryableError(error),
        'DOMAIN_DELETE_FAILED'
      );
    }
  }

  private validateConfig(config: Record<string, any>): ResendConfig {
    if (!config.apiKey) {
      throw new Error('Missing required Resend API key');
    }

    return {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.resend.com',
      defaultFromDomain: config.defaultFromDomain
    };
  }

  private createClient(): void {
    if (!this.config) {
      throw new Error('No configuration available');
    }

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Add response interceptor to log rate limit info
    this.client.interceptors.response.use(
      (response) => {
        const rateLimit = response.headers['x-ratelimit-remaining'];
        
        if (rateLimit && parseInt(rateLimit, 10) < 10) {
          logger.warn(`[ResendEmailProvider:${this.providerId}] Low rate limit remaining: ${rateLimit}`);
        }
        
        return response;
      },
      (error) => {
        return Promise.reject(error);
      }
    );
  }

  private async verifyConnection(): Promise<void> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    try {
      // Make a simple API call to verify the connection and API key
      await this.client.get('/domains');
      logger.info(`[ResendEmailProvider:${this.providerId}] API connection verified`);
    } catch (error: any) {
      logger.error(`[ResendEmailProvider:${this.providerId}] API verification failed:`, error);
      throw new Error(`Resend API verification failed: ${error.message}`);
    }
  }

  private buildEmailRequest(message: EmailMessage): ResendEmailRequest {
    const request: ResendEmailRequest = {
      from: this.formatAddress(message.from),
      to: message.to.map(addr => this.formatAddress(addr)),
      subject: message.subject
    };

    if (message.cc && message.cc.length > 0) {
      request.cc = message.cc.map(addr => this.formatAddress(addr));
    }

    if (message.bcc && message.bcc.length > 0) {
      request.bcc = message.bcc.map(addr => this.formatAddress(addr));
    }

    if (message.replyTo) {
      request.reply_to = [this.formatAddress(message.replyTo)];
    }

    if (message.text) {
      request.text = message.text;
    }

    if (message.html) {
      request.html = message.html;
    }

    if (message.attachments && message.attachments.length > 0) {
      request.attachments = message.attachments.map(att => this.convertAttachment(att));
    }

    if (message.headers) {
      request.headers = message.headers;
    }

    if (message.tags) {
      request.tags = Object.entries(message.tags).map(([name, value]) => ({ name, value }));
    }

    return request;
  }

  private formatAddress(address: EmailAddress): string {
    if (address.name) {
      return `${address.name} <${address.email}>`;
    }
    return address.email;
  }

  private convertAttachment(attachment: EmailAttachment): any {
    let content: string;
    
    if (Buffer.isBuffer(attachment.content)) {
      content = attachment.content.toString('base64');
    } else if (typeof attachment.content === 'string') {
      // Assume it's already base64 if it's a string
      content = attachment.content;
    } else {
      throw new Error('Invalid attachment content type');
    }

    const result: any = {
      filename: attachment.filename,
      content
    };

    if (attachment.contentType) {
      result.content_type = attachment.contentType;
    }

    return result;
  }

  private parseResendError(error: any): ResendErrorResponse {
    if (error.response?.data) {
      const data = error.response.data;
      if (data.message && data.name) {
        return {
          message: data.message,
          name: data.name
        };
      }
    }

    return {
      message: error.message || 'Unknown Resend error',
      name: 'UnknownError'
    };
  }

  private isRetryableError(error: any): boolean {
    if (error.code) {
      const retryableCodes = [
        'ECONNRESET',
        'ENOTFOUND',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EMFILE',
        'ENFILE'
      ];
      
      if (retryableCodes.includes(error.code)) {
        return true;
      }
    }

    if (error.response?.status) {
      const status = error.response.status;
      // 5xx errors and 429 (rate limit) are retryable
      if (status >= 500 || status === 429) {
        return true;
      }
    }

    return false;
  }
}