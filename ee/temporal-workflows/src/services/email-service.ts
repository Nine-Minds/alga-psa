import { Context } from '@temporalio/activity';

const logger = () => Context.current().log;

export interface EmailServiceInterface {
  sendEmail(params: EmailParams): Promise<EmailResult>;
  validateEmail(email: string): boolean;
  getEmailTemplate(templateName: string): EmailTemplate | null;
}

export interface EmailParams {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: EmailAttachment[];
  metadata?: Record<string, any>;
}

export interface EmailResult {
  messageId: string;
  accepted?: string[];
  rejected?: string[];
  pending?: string[];
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  disposition?: 'attachment' | 'inline';
}

export interface EmailTemplate {
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  variables: string[];
}

/**
 * Mock Email Service for testing and development
 * This simulates email sending without actually sending emails
 */
export class MockEmailService implements EmailServiceInterface {
  private sentEmails: Array<EmailParams & { timestamp: Date; messageId: string }> = [];
  private failureRate: number = 0; // 0-1, probability of failure for testing
  private delayMs: number = 100; // Simulated network delay

  constructor(options: { failureRate?: number; delayMs?: number } = {}) {
    this.failureRate = options.failureRate || 0;
    this.delayMs = options.delayMs || 100;
  }

  async sendEmail(params: EmailParams): Promise<EmailResult> {
    const log = logger();
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, this.delayMs));

    // Simulate random failures for testing
    if (Math.random() < this.failureRate) {
      throw new Error('Mock email service failure (simulated)');
    }

    // Validate email format
    const recipients = Array.isArray(params.to) ? params.to : [params.to];
    const validEmails = recipients.filter(email => this.validateEmail(email));
    const invalidEmails = recipients.filter(email => !this.validateEmail(email));

    if (validEmails.length === 0) {
      throw new Error('No valid email addresses provided');
    }

    const messageId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store sent email for testing verification
    this.sentEmails.push({
      ...params,
      timestamp: new Date(),
      messageId
    });

    log.info('Mock email sent successfully', {
      messageId,
      to: params.to,
      subject: params.subject,
      validRecipients: validEmails.length,
      invalidRecipients: invalidEmails.length,
      hasHtml: !!params.html,
      hasText: !!params.text,
      metadata: params.metadata
    });

    return {
      messageId,
      accepted: validEmails,
      rejected: invalidEmails,
      pending: []
    };
  }

  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  getEmailTemplate(templateName: string): EmailTemplate | null {
    // Mock templates for testing
    const templates: Record<string, EmailTemplate> = {
      'tenant_welcome': {
        name: 'tenant_welcome',
        subject: 'Welcome to {{tenantName}} - Your Account is Ready',
        htmlBody: '<h1>Welcome {{firstName}}!</h1><p>Your tenant {{tenantName}} is ready.</p>',
        textBody: 'Welcome {{firstName}}! Your tenant {{tenantName}} is ready.',
        variables: ['firstName', 'tenantName', 'temporaryPassword', 'loginUrl']
      },
      'password_reset': {
        name: 'password_reset',
        subject: 'Password Reset Request for {{tenantName}}',
        htmlBody: '<h1>Password Reset</h1><p>Click here to reset: {{resetUrl}}</p>',
        textBody: 'Password Reset. Click here to reset: {{resetUrl}}',
        variables: ['firstName', 'tenantName', 'resetUrl']
      }
    };

    return templates[templateName] || null;
  }

  // Testing utilities
  getSentEmails(): Array<EmailParams & { timestamp: Date; messageId: string }> {
    return [...this.sentEmails];
  }

  getEmailsTo(email: string): Array<EmailParams & { timestamp: Date; messageId: string }> {
    return this.sentEmails.filter(sentEmail => {
      const recipients = Array.isArray(sentEmail.to) ? sentEmail.to : [sentEmail.to];
      return recipients.includes(email);
    });
  }

  clearSentEmails(): void {
    this.sentEmails = [];
  }

  getEmailCount(): number {
    return this.sentEmails.length;
  }

  setFailureRate(rate: number): void {
    this.failureRate = Math.max(0, Math.min(1, rate));
  }

  setDelay(ms: number): void {
    this.delayMs = Math.max(0, ms);
  }
}

/**
 * Production Email Service adapter
 * This would integrate with your actual email service (AWS SES, SendGrid, etc.)
 */
export class ProductionEmailService implements EmailServiceInterface {
  private provider: 'aws-ses' | 'sendgrid' | 'smtp';
  private config: Record<string, any>;

  constructor(provider: 'aws-ses' | 'sendgrid' | 'smtp', config: Record<string, any>) {
    this.provider = provider;
    this.config = config;
  }

  async sendEmail(params: EmailParams): Promise<EmailResult> {
    const log = logger();
    
    // Validate inputs
    if (!this.validateEmail(Array.isArray(params.to) ? params.to[0] : params.to)) {
      throw new Error('Invalid email address format');
    }

    if (!params.subject?.trim()) {
      throw new Error('Email subject is required');
    }

    if (!params.html?.trim() && !params.text?.trim()) {
      throw new Error('Email body (HTML or text) is required');
    }

    try {
      switch (this.provider) {
        case 'aws-ses':
          return await this.sendViaSES(params);
        case 'sendgrid':
          return await this.sendViaSendGrid(params);
        case 'smtp':
          return await this.sendViaSMTP(params);
        default:
          throw new Error(`Unsupported email provider: ${this.provider}`);
      }
    } catch (error) {
      log.error('Failed to send email via production service', {
        provider: this.provider,
        error: error instanceof Error ? error.message : 'Unknown error',
        to: params.to,
        subject: params.subject
      });
      throw error;
    }
  }

  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  getEmailTemplate(templateName: string): EmailTemplate | null {
    // This would integrate with your template storage system
    // Could be database, file system, or external service
    return null;
  }

  private async sendViaSES(params: EmailParams): Promise<EmailResult> {
    // AWS SES implementation would go here
    throw new Error('AWS SES integration not implemented');
  }

  private async sendViaSendGrid(params: EmailParams): Promise<EmailResult> {
    // SendGrid implementation would go here
    throw new Error('SendGrid integration not implemented');
  }

  private async sendViaSMTP(params: EmailParams): Promise<EmailResult> {
    // SMTP implementation would go here
    throw new Error('SMTP integration not implemented');
  }
}

/**
 * Email Service Factory
 * Creates the appropriate email service based on environment configuration
 */
export function createEmailService(config?: {
  provider?: 'mock' | 'aws-ses' | 'sendgrid' | 'smtp';
  options?: Record<string, any>;
}): EmailServiceInterface {
  const provider = config?.provider || process.env.EMAIL_PROVIDER || 'mock';
  const options = config?.options || {};

  switch (provider) {
    case 'mock':
      return new MockEmailService({
        failureRate: options.failureRate || 0,
        delayMs: options.delayMs || 100
      });
    
    case 'aws-ses':
    case 'sendgrid':
    case 'smtp':
      return new ProductionEmailService(provider, options);
    
    default:
      throw new Error(`Unknown email provider: ${provider}`);
  }
}

// Export singleton instance for use in activities
export const emailService = createEmailService();