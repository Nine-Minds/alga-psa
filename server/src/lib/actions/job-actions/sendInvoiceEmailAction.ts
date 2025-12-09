'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from '../user-actions/userActions';
import { getInvoiceForRendering } from '../invoiceQueries';
import { getClientById } from '../client-actions/clientActions';
import ContactModel from 'server/src/lib/models/contact';
import { SystemEmailProviderFactory } from 'server/src/lib/email/system/SystemEmailProviderFactory';
import { createPDFGenerationService } from 'server/src/services/pdf-generation.service';
import { StorageService } from 'server/src/lib/storage/StorageService';
import { getTenantDetails } from '../tenantActions';
import { EmailMessage } from 'server/src/types/email.types';
import { formatCurrency } from 'server/src/lib/utils/formatters';
import { dateValueToDate } from 'server/src/lib/utils/dateTimeUtils';
import Handlebars from 'handlebars';
import fs from 'fs/promises';
import logger from '@shared/core/logger';

export interface SendInvoiceEmailResult {
  success: boolean;
  invoiceNumber: string;
  recipientEmail: string;
  error?: string;
}

export interface SendInvoiceEmailsResult {
  results: SendInvoiceEmailResult[];
  successCount: number;
  failureCount: number;
}

interface InvoiceEmailTemplate {
  subject: string;
  html_content: string;
  text_content: string;
}

/**
 * Looks up the invoice-email template from tenant or system templates
 */
async function getInvoiceEmailTemplate(knex: any, tenant: string): Promise<InvoiceEmailTemplate> {
  // First try tenant-specific template
  let template = await knex('tenant_email_templates')
    .where({
      tenant,
      name: 'invoice-email',
      language_code: 'en'
    })
    .first();

  if (!template) {
    // Fall back to system template
    template = await knex('system_email_templates')
      .where({
        name: 'invoice-email',
        language_code: 'en'
      })
      .first();
  }

  if (!template) {
    // Return a basic fallback template if none exists in database
    return {
      subject: 'Invoice {{invoice.number}} from {{company.name}}',
      html_content: `
        <p>Dear {{recipient.name}},</p>
        <p>Please find attached your invoice {{invoice.number}} for {{invoice.amount}}.</p>
        {{#if customMessage}}<p><strong>Note:</strong> {{customMessage}}</p>{{/if}}
        <p>Thank you for your business!</p>
        <p>Best regards,<br>{{company.name}}</p>
      `,
      text_content: `Dear {{recipient.name}},

Please find attached your invoice {{invoice.number}} for {{invoice.amount}}.

{{#if customMessage}}Note: {{customMessage}}{{/if}}

Thank you for your business!

Best regards,
{{company.name}}`
    };
  }

  return {
    subject: template.subject,
    html_content: template.html_content,
    text_content: template.text_content
  };
}

/**
 * Synchronously sends invoice emails and returns real results.
 * Uses SystemEmailProviderFactory which supports both SMTP and Resend.
 * @param invoiceIds - Array of invoice IDs to send
 * @param customMessage - Optional custom message to include in the email
 */
export async function sendInvoiceEmailAction(invoiceIds: string[], customMessage?: string): Promise<SendInvoiceEmailsResult> {
  const { knex, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!tenant || !currentUser) {
    throw new Error('Tenant or user not found');
  }

  if (!invoiceIds || invoiceIds.length === 0) {
    throw new Error('No invoice IDs provided');
  }

  // Create email provider using SystemEmailProviderFactory (supports SMTP and Resend)
  const emailProvider = await SystemEmailProviderFactory.createProvider();
  if (!emailProvider) {
    throw new Error('Email is not configured. Please configure email settings in Settings before sending invoices.');
  }

  const pdfService = createPDFGenerationService(tenant);
  const results: SendInvoiceEmailResult[] = [];

  // Get tenant company name for email template
  const { clients } = await getTenantDetails();
  const defaultClient = clients.find(c => c.is_default);
  const companyName = defaultClient?.client_name || 'Your Company';
  const fromEmail = process.env.EMAIL_FROM || 'noreply@example.com';

  for (const invoiceId of invoiceIds) {
    let tempPdfPath: string | null = null;

    try {
      // Get invoice details
      const invoice = await getInvoiceForRendering(invoiceId);
      if (!invoice || !invoice.invoice_number) {
        results.push({
          success: false,
          invoiceNumber: invoiceId,
          recipientEmail: '',
          error: `Invoice ${invoiceId} not found`
        });
        continue;
      }

      // Get client details
      const client = await getClientById(invoice.client_id);
      if (!client) {
        results.push({
          success: false,
          invoiceNumber: invoice.invoice_number,
          recipientEmail: '',
          error: `Client not found for invoice ${invoice.invoice_number}`
        });
        continue;
      }

      // Determine recipient email with priority order
      let recipientEmail = client.location_email || '';
      let recipientName = client.client_name;

      if (client.billing_contact_id) {
        const contact = await ContactModel.get(knex, client.billing_contact_id);
        if (contact) {
          recipientEmail = contact.email;
          recipientName = contact.full_name;
        }
      } else if (client.billing_email) {
        recipientEmail = client.billing_email;
      }

      if (!recipientEmail) {
        results.push({
          success: false,
          invoiceNumber: invoice.invoice_number,
          recipientEmail: '',
          error: `No email address found for ${client.client_name}`
        });
        continue;
      }

      // Generate PDF
      logger.info('[sendInvoiceEmailAction] Generating PDF', {
        invoiceId,
        invoiceNumber: invoice.invoice_number
      });

      const { file_id } = await pdfService.generateAndStore({
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        version: 1,
        userId: currentUser.user_id
      });

      // Download PDF to temp file for email attachment
      const { buffer } = await StorageService.downloadFile(file_id);
      tempPdfPath = `/tmp/invoice_${invoice.invoice_number}_${Date.now()}.pdf`;
      await fs.writeFile(tempPdfPath, buffer);

      // Read PDF buffer for attachment
      const pdfBuffer = await fs.readFile(tempPdfPath);

      // Format total amount with proper currency
      const currencyCode = invoice.currencyCode || 'USD';
      const totalAmount = formatCurrency(invoice.total_amount / 100, 'en-US', currencyCode);

      // Format dates
      const invoiceDate = invoice.invoice_date
        ? dateValueToDate(invoice.invoice_date).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
          })
        : 'N/A';

      const dueDate = invoice.due_date
        ? dateValueToDate(invoice.due_date).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric'
          })
        : 'N/A';

      // Get email template
      const emailTemplate = await getInvoiceEmailTemplate(knex, tenant);

      // Build context for template
      const templateContext = {
        invoice: {
          number: invoice.invoice_number,
          amount: totalAmount,
          invoiceDate,
          dueDate
        },
        client: {
          name: client.client_name
        },
        recipient: {
          name: recipientName,
          email: recipientEmail
        },
        company: {
          name: companyName
        },
        customMessage: customMessage || ''
      };

      // Compile templates with Handlebars
      const subjectTemplate = Handlebars.compile(emailTemplate.subject);
      const htmlTemplate = Handlebars.compile(emailTemplate.html_content);
      const textTemplate = Handlebars.compile(emailTemplate.text_content);

      const compiledSubject = subjectTemplate(templateContext);
      const compiledHtml = htmlTemplate(templateContext);
      const compiledText = textTemplate(templateContext);

      // Build email message
      const emailMessage: EmailMessage = {
        from: {
          email: fromEmail,
          name: companyName
        },
        to: [{
          email: recipientEmail,
          name: recipientName
        }],
        subject: compiledSubject,
        html: compiledHtml,
        text: compiledText,
        attachments: [{
          filename: `invoice_${invoice.invoice_number}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }]
      };

      // Send the email
      logger.info('[sendInvoiceEmailAction] Sending email', {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        recipientEmail
      });

      const sendResult = await emailProvider.sendEmail(emailMessage, tenant);

      if (!sendResult.success) {
        results.push({
          success: false,
          invoiceNumber: invoice.invoice_number,
          recipientEmail,
          error: sendResult.error || 'Email service returned failure'
        });
        continue;
      }

      logger.info('[sendInvoiceEmailAction] Email sent successfully', {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        recipientEmail,
        messageId: sendResult.messageId
      });

      results.push({
        success: true,
        invoiceNumber: invoice.invoice_number,
        recipientEmail
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('[sendInvoiceEmailAction] Failed to send email', {
        invoiceId,
        error: errorMessage
      });

      results.push({
        success: false,
        invoiceNumber: invoiceId,
        recipientEmail: '',
        error: errorMessage
      });
    } finally {
      // Clean up temp file
      if (tempPdfPath) {
        try {
          await fs.unlink(tempPdfPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;

  return {
    results,
    successCount,
    failureCount
  };
}
