import nodemailer from 'nodemailer';
import { getSecret } from '../lib/utils/getSecret';
import { StorageService } from '@/lib/storage/StorageService';
import { InvoiceViewModel } from '@/interfaces/invoice.interfaces';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { getTenantDetails } from '@/lib/actions/tenantActions';

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
  company_name: string;
  invoice_number: string;
  total_amount: string;
  sender_company: string;
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
    const isEnabled = process.env.EMAIL_ENABLE === 'true';
    
    if (!isEnabled) {
      console.log('[EmailService] Email notifications are disabled via EMAIL_ENABLE environment variable');
      return;
    }

    const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
    const port = parseInt(process.env.EMAIL_PORT || process.env.SMTP_PORT || '587', 10);
    const username = process.env.EMAIL_USERNAME || process.env.SMTP_USER;
    const password = await getSecret('email_password', 'EMAIL_PASSWORD') || process.env.SMTP_PASS;
    const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || username;

    const missingConfigs = [];
    if (!host) missingConfigs.push('EMAIL_HOST/SMTP_HOST');
    if (!username) missingConfigs.push('EMAIL_USERNAME/SMTP_USER');
    if (!password) missingConfigs.push('EMAIL_PASSWORD/SMTP_PASS');
    if (!from) missingConfigs.push('EMAIL_FROM/SMTP_FROM');

    if (missingConfigs.length > 0) {
      console.error('[EmailService] Missing required email configuration:', missingConfigs.join(', '));
      return;
    }

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

      // Verify transporter configuration
      await this.transporter.verify();
      console.log('[EmailService] Transporter verified successfully');
    } catch (error) {
      console.error('[EmailService] Failed to initialize transporter:', error);
      this.transporter = null;
    }
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await this.initializeConfig();
    this.initialized = true;
  }

  public async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.config?.isEnabled || !this.transporter) {
      console.log('[EmailService] Email service is not enabled or not properly configured');
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
    pdfPath: string
  ) {
    const { companies } = await getTenantDetails();
    const defaultCompany = companies.find(c => c.is_default);
    const senderCompany = defaultCompany?.company_name || 'Our Company';

    const template = await this.getInvoiceEmailTemplate();
    const attachments = [{
      filename: `invoice_${invoice.invoice_number}.pdf`,
      path: pdfPath,
      contentType: 'application/pdf'
    }];

    const templateData: InvoiceEmailTemplateData = {
      company_name: invoice.company.name,
      invoice_number: invoice.invoice_number,
      total_amount: `$${(invoice.total_amount / 100).toFixed(2)}`,
      sender_company: senderCompany
    };

    const html = this.renderInvoiceTemplate(template.body, templateData);
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

  private async getInvoiceEmailTemplate() {
    // TODO: Fetch from database
    return {
      subject: 'Invoice {{invoice_number}} from {{sender_company}}',
      body: `
        <p>Dear {{company_name}},</p>
        <p>Please find attached your invoice {{invoice_number}} for {{total_amount}}.</p>
        <p>Thank you for your business!</p>
        <p>Best regards,<br>{{sender_company}}</p>
      `
    };
  }

  private async getEmailTemplate(templateName: string): Promise<string | null> {
    // TODO: Load templates from database
    const templates: Record<string, string> = {
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

    return templates[templateName] || null;
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