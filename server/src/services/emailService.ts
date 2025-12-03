import nodemailer from 'nodemailer';
import { getSecret } from '../lib/utils/getSecret';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getTenantDetails } from 'server/src/lib/actions/tenantActions';
import { createTenantKnex } from 'server/src/lib/db';

interface EmailConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  isEnabled: boolean;
}

interface EmailAttachment {
  filename: string;
  path: string;
  contentType: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
}

interface SendEmailOptions {
  toEmail: string;
  subject: string;
  templateName: string;
  templateData: Record<string, any>;
}

interface InvoiceEmailTemplateData {
  client_name: string;
  invoice_number: string;
  total_amount: string;
  sender_client: string;
}

export class EmailService {
  private static instance: EmailService;
  private transporter: nodemailer.Transporter | null = null;
  private config: EmailConfig | null = null;
  private initialized: boolean = false;
  private storageService: StorageService;

  private constructor() {
    this.storageService = new StorageService();
  }

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  private async initializeConfig() {
    console.log('[EmailService] Starting email service configuration');
    console.log('[EmailService] Environment variables check:', {
      EMAIL_ENABLE: process.env.EMAIL_ENABLE,
      EMAIL_HOST: process.env.EMAIL_HOST,
      EMAIL_PORT: process.env.EMAIL_PORT,
      EMAIL_USERNAME: process.env.EMAIL_USERNAME,
      EMAIL_FROM: process.env.EMAIL_FROM,
      // Don't log password for security
      HAS_EMAIL_PASSWORD: !!process.env.EMAIL_PASSWORD
    });
    
    const isEnabled = process.env.EMAIL_ENABLE === 'true';
    
    if (!isEnabled) {
      console.log('[EmailService] Email notifications are disabled via EMAIL_ENABLE environment variable:', {
        EMAIL_ENABLE_VALUE: process.env.EMAIL_ENABLE,
        EXPECTED_VALUE: 'true',
        ACTUAL_TYPE: typeof process.env.EMAIL_ENABLE
      });
      return;
    }

    const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
    const port = parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587', 10);
    const username = process.env.EMAIL_USERNAME || process.env.SMTP_USER;
    const password = await getSecret('email_password', 'EMAIL_PASSWORD') || process.env.SMTP_PASS;
    const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || username;

    const missingConfigs: string[] = [];
    if (!host) missingConfigs.push('EMAIL_HOST/SMTP_HOST');
    if (!username) missingConfigs.push('EMAIL_USERNAME/SMTP_USER');
    if (!password) missingConfigs.push('EMAIL_PASSWORD/SMTP_PASS');
    if (!from) missingConfigs.push('EMAIL_FROM/SMTP_FROM');

    if (missingConfigs.length > 0) {
      console.error('[EmailService] Missing required email configuration:', {
        missingConfigs: missingConfigs.join(', '),
        availableValues: {
          host: !!host,
          username: !!username,
          password: !!password,
          from: !!from
        }
      });
      return;
    }

    console.log('[EmailService] Configuration validated successfully:', {
      host: host,
      port: port,
      username: username,
      from: from,
      isEnabled: isEnabled
    });

    this.config = {
      host: host!,
      port,
      username: username!,
      password: password!,
      from: from!,
      isEnabled
    };

    await this.initializeTransporter();
  }

  private async initializeTransporter() {
    if (!this.config) {
      console.log('[EmailService] Cannot initialize transporter - missing configuration');
      return;
    }

    console.log('[EmailService] Initializing transporter with config:', {
      host: this.config.host,
      port: this.config.port,
      secure: this.config.port === 465,
      username: this.config.username
    });

    try {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.port === 465,
        auth: {
          user: this.config.username,
          pass: this.config.password
        }
      });

      console.log('[EmailService] Transporter created, attempting verification...');
      
      // Verify transporter configuration
      await this.transporter.verify();
      console.log('[EmailService] Transporter verified successfully');
    } catch (error) {
      console.error('[EmailService] Failed to initialize transporter:', {
        error: error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        config: {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username
        }
      });
      this.transporter = null;
    }
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await this.initializeConfig();
    this.initialized = true;
  }

  public async sendEmail(options: EmailOptions): Promise<boolean> {
    console.log('[EmailService] sendEmail called with options:', {
      to: options.to,
      subject: options.subject,
      hasHtml: !!options.html,
      hasText: !!options.text,
      attachmentCount: options.attachments?.length || 0
    });

    // Detailed diagnostics
    const diagnostics = {
      isInitialized: this.initialized,
      hasConfig: !!this.config,
      configIsEnabled: this.config?.isEnabled,
      hasTransporter: !!this.transporter,
      transporterType: this.transporter?.constructor?.name
    };

    console.log('[EmailService] Service state diagnostics:', diagnostics);

    if (!this.config?.isEnabled) {
      console.log('[EmailService] Service disabled - config.isEnabled is false or config missing:', {
        hasConfig: !!this.config,
        configIsEnabled: this.config?.isEnabled,
        configDetails: this.config ? {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          from: this.config.from
        } : null
      });
      return false;
    }

    if (!this.transporter) {
      console.log('[EmailService] Service disabled - transporter is null/undefined:', {
        hasConfig: !!this.config,
        transporterValue: this.transporter,
        initializationAttempted: this.initialized
      });
      return false;
    }

    try {
      const user = await getCurrentUser();
      const from = user?.email 
        ? `"${user.email}" <${this.config.from}>`
        : this.config.from;

      const result = await this.transporter.sendMail({
        from,
        ...options
      });

      console.log('[EmailService] Email sent successfully:', {
        messageId: result.messageId,
        response: result.response
      });

      return true;
    } catch (error) {
      console.error('[EmailService] Failed to send email:', error);
      return false;
    }
  }

  public async sendInvoiceEmail(
    invoice: InvoiceViewModel & { 
      contact?: { name: string; address: string };
      recipientEmail: string; 
      tenantId: string;
    }, 
    pdfPath: string,
    options?: {
      paymentLink?: string;
      companyName?: string;
    }
  ) {
    const { clients } = await getTenantDetails();
    const defaultClient = clients.find(c => c.is_default);
    const senderClient = options?.companyName || defaultClient?.client_name || 'Our Client';

    const hasPaymentLink = !!options?.paymentLink;
    const template = await this.getInvoiceEmailTemplate(hasPaymentLink);
    const attachments = [{
      filename: `invoice_${invoice.invoice_number}.pdf`,
      path: pdfPath,
      contentType: 'application/pdf'
    }];

    const templateData: InvoiceEmailTemplateData = {
      client_name: invoice.client.name,
      invoice_number: invoice.invoice_number,
      total_amount: `$${(invoice.total_amount / 100).toFixed(2)}`,
      sender_client: senderClient
    };

    let html = this.renderInvoiceTemplate(template.body, templateData);
    if (options?.paymentLink) {
      html = html.replace(/{{payment_link}}/g, options.paymentLink);
    }
    const text = this.stripHtml(html);
    const subject = template.subject.replace(/{{([^}]+)}}/g, (_, key) => templateData[key as keyof InvoiceEmailTemplateData] || '');

    return await this.sendEmail({
      to: invoice.recipientEmail,
      subject,
      html,
      text,
      attachments
    });
  }

  public async sendTemplatedEmail(options: SendEmailOptions): Promise<boolean> {
    const template = await this.getEmailTemplate(options.templateName);
    if (!template) {
      console.error(`[EmailService] Template '${options.templateName}' not found`);
      return false;
    }

    const html = this.renderTemplate(template, options.templateData);
    const text = this.stripHtml(html);

    return this.sendEmail({
      to: options.toEmail,
      subject: options.subject,
      html,
      text
    });
  }

  private async getInvoiceEmailTemplate(hasPaymentLink: boolean = false) {
    // TODO: Fetch from database
    const paymentSection = hasPaymentLink ? `
        <div style="margin: 24px 0; text-align: center;">
          <a href="{{payment_link}}"
             style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">
            Pay Now - {{total_amount}}
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px; text-align: center;">
          Or copy this link to pay: <a href="{{payment_link}}" style="color: #4f46e5;">{{payment_link}}</a>
        </p>
    ` : '';

    return {
      subject: 'Invoice {{invoice_number}} from {{sender_client}}',
      body: `
        <p>Dear {{client_name}},</p>
        <p>Please find attached your invoice {{invoice_number}} for {{total_amount}}.</p>
        ${paymentSection}
        <p>Thank you for your business!</p>
        <p>Best regards,<br>{{sender_client}}</p>
      `
    };
  }

  private async getEmailTemplate(templateName: string): Promise<string | null> {
    // First try to get system template from database for notification emails
    try {
      const { knex } = await createTenantKnex();
      const template = await knex('system_email_templates')
        .select('html_content')
        .where({ name: templateName })
        .first();

      if (template?.html_content) {
        console.log('[EmailService] Found template in database:', {
          templateName,
          contentLength: template.html_content.length
        });
        return template.html_content;
      }
    } catch (error) {
      console.error('[EmailService] Error fetching email template from database:', error);
    }

    // Fall back to hardcoded templates for auth-related emails
    const authTemplates: Record<string, string> = {
      verify_email: `
        <p>Hello {{username}},</p>
        <p>Please verify your email by clicking the link below:</p>
        <p><a href="{{verificationUrl}}">Verify Email</a></p>
      `,
      recover_password_email: `
        <p>Hello {{username}},</p>
        <p>Click the link below to reset your password:</p>
        <p><a href="{{recoverUrl}}">Reset Password</a></p>
      `
    };

    const template = authTemplates[templateName];
    if (template) {
      console.log('[EmailService] Using hardcoded auth template:', { templateName });
      return template;
    }

    console.error('[EmailService] Template not found:', { templateName });
    return null;
  }

  private renderInvoiceTemplate(template: string, data: InvoiceEmailTemplateData): string {
    return Object.entries(data).reduce((html, [key, value]) => {
      return html.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }, template);
  }

  private renderTemplate(template: string, data: Record<string, any>): string {
    return Object.entries(data).reduce((html, [key, value]) => {
      return html.replace(new RegExp(`{{${key}}}`, 'g'), value as string);
    }, template);
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public isConfigured(): boolean {
    return this.config?.isEnabled === true && this.transporter !== null;
  }
}

// Export singleton instance getter
export async function getEmailService(): Promise<EmailService> {
  const service = EmailService.getInstance();
  await service.initialize();
  return service;
}

// Export types
export type { EmailOptions, SendEmailOptions, EmailAttachment };
