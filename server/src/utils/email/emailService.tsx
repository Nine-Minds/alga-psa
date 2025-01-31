import nodemailer from 'nodemailer';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { StorageService } from '@/lib/storage/StorageService';
import { InvoiceViewModel } from '@/interfaces/invoice.interfaces';

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
  private transporter: nodemailer.Transporter;
  private storageService: StorageService;

  constructor() {
    this.storageService = new StorageService();
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async send(options: EmailOptions) {
    const user = await getCurrentUser();
    
    return this.transporter.sendMail({
      from: `"${user?.email}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      ...options
    });
  }

  async sendInvoiceEmail(
    invoice: InvoiceViewModel & { 
      contact?: { name: string; address: string };
      recipientEmail: string; 
    }, 
    pdfPath: string
  ) {
    const template = await this.getInvoiceEmailTemplate();
    const attachments = [{
      filename: `invoice_${invoice.invoice_number}.pdf`,
      path: pdfPath,
      contentType: 'application/pdf'
    }];

    return this.send({
      to: invoice.recipientEmail,
      subject: template.subject.replace('{{invoice_number}}', invoice.invoice_number),
      html: this.renderInvoiceTemplate(template.body, invoice),
      attachments
    });
  }

  private async getInvoiceEmailTemplate() {
    // TODO: Fetch from database
    return {
      subject: 'Invoice {{invoice_number}} from Your Company',
      body: `
        <p>Dear {{company_name}},</p>
        <p>Please find attached your invoice {{invoice_number}} for {{total_amount}}.</p>
        <p>Thank you for your business!</p>
      `
    };
  }

  private renderInvoiceTemplate(template: string, invoice: InvoiceViewModel) {
    return template
      .replace(/{{company_name}}/g, invoice.company.name)
      .replace(/{{invoice_number}}/g, invoice.invoice_number)
      .replace(/{{total_amount}}/g, `$${(invoice.total_amount / 100).toFixed(2)}`);
  }
}
