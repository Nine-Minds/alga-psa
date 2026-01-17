import nodemailer from 'nodemailer';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

interface EmailAttachment {
  filename: string;
  path: string;
  contentType: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

interface SendEmailOptions {
  toEmail: string;
  subject: string;
  templateName: string;
  templateData: Record<string, any>;
}

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  try {
    const emailService = new EmailService();
    const template = await getEmailTemplate(options.templateName, options.templateData);
    await emailService.send({
      to: options.toEmail,
      subject: options.subject,
      html: template
    });
    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

async function getEmailTemplate(templateName: string, data: Record<string, any>): Promise<string> {
  // TODO: Load templates from database or files
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

  const template = templates[templateName];
  if (!template) {
    throw new Error(`Email template '${templateName}' not found`);
  }

  return Object.entries(data).reduce((html, [key, value]) => {
    return html.replace(new RegExp(`{{${key}}}`, 'g'), value as string);
  }, template);
}

export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private storageService: StorageService;

  constructor() {
    this.storageService = new StorageService();
  }

  private async getTransporter(): Promise<nodemailer.Transporter> {
    if (this.transporter) {
      return this.transporter;
    }

    const secretProvider = await getSecretProviderInstance();

    // Get SMTP credentials from secret provider with fallback to environment variables
    const smtpUser = await secretProvider.getAppSecret('SMTP_USER') || process.env.SMTP_USER;
    const smtpPass = await secretProvider.getAppSecret('SMTP_PASS') || process.env.SMTP_PASS;

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });

    return this.transporter;
  }

  async send(options: EmailOptions) {
    const user = await getCurrentUser();
    const transporter = await this.getTransporter();

    return transporter.sendMail({
      from: `"${user?.email}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      ...options
    });
  }

  async sendInvoiceEmail(
    invoice: InvoiceViewModel & {
      contact?: { name: string; address: string };
      recipientEmail: string;
      tenantId?: string;
    },
    pdfPath: string,
    options?: {
      paymentLink?: string;
      companyName?: string;
    }
  ) {
    const hasPaymentLink = !!options?.paymentLink;
    const template = await this.getInvoiceEmailTemplate(hasPaymentLink);
    const attachments = [{
      filename: `invoice_${invoice.invoice_number}.pdf`,
      path: pdfPath,
      contentType: 'application/pdf'
    }];

    return this.send({
      to: invoice.recipientEmail,
      subject: template.subject
        .replace('{{invoice_number}}', invoice.invoice_number)
        .replace('{{company_name}}', options?.companyName || 'Your Company'),
      html: this.renderInvoiceTemplate(template.body, invoice, options),
      attachments
    });
  }

  private async getInvoiceEmailTemplate(hasPaymentLink: boolean = false) {
    // TODO: Fetch from database based on tenant settings
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
      subject: 'Invoice {{invoice_number}} from {{company_name}}',
      body: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <p style="color: #374151; font-size: 16px;">Dear {{client_name}},</p>
          <p style="color: #374151; font-size: 16px;">Please find attached your invoice <strong>{{invoice_number}}</strong> for <strong>{{total_amount}}</strong>.</p>
          ${paymentSection}
          <p style="color: #374151; font-size: 16px;">Thank you for your business!</p>
          <p style="color: #374151; font-size: 16px;">Best regards,<br>{{company_name}}</p>
        </div>
      `
    };
  }

  private renderInvoiceTemplate(
    template: string,
    invoice: InvoiceViewModel,
    options?: {
      paymentLink?: string;
      companyName?: string;
    }
  ) {
    let result = template
      .replace(/{{client_name}}/g, invoice.client.name)
      .replace(/{{invoice_number}}/g, invoice.invoice_number)
      .replace(/{{total_amount}}/g, `$${(invoice.total_amount / 100).toFixed(2)}`)
      .replace(/{{company_name}}/g, options?.companyName || 'Your Company');

    if (options?.paymentLink) {
      result = result.replace(/{{payment_link}}/g, options.paymentLink);
    }

    return result;
  }
}
