'use server';

import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@alga-psa/db';
import { JobService, type JobData } from '@alga-psa/jobs';
import { getInvoiceForRendering } from './invoiceQueries';
import { createPDFGenerationService } from '../services/pdfGenerationService';
import { StorageService } from '@alga-psa/documents/storage/StorageService';
import { SystemEmailProviderFactory } from '@alga-psa/email';
import { EmailMessage, EmailAddress } from '@alga-psa/types';
import { formatCurrency, dateValueToDate, isValidEmail } from '@alga-psa/core';
import type { IContact } from '@alga-psa/types';
import Handlebars from 'handlebars';
import fs from 'fs/promises';
import { withAuth } from '@alga-psa/auth';
import { getClientById } from '@alga-psa/shared/billingClients/clients';

interface InitialJobData extends JobData {
  requesterId: string;
  user_id: string;
  invoiceIds: string[];
  metadata: {
    user_id: string;
    invoice_count: number;
    tenantId: string;
  };
}

export const scheduleInvoiceZipAction = withAuth(async (
  user,
  { tenant },
  invoiceIds: string[]
) => {
  const { knex } = await createTenantKnex();

  const jobService = await JobService.create();

  const steps = [
    ...invoiceIds.map((id, index) => ({
      stepName: `Process Invoice ${index + 1}`,
      type: 'invoice_processing',
      metadata: { invoiceId: id, tenantId: tenant },
    })),
    {
      stepName: 'Create ZIP Archive',
      type: 'zip_creation',
      metadata: { tenantId: tenant },
    },
  ];

  const jobData: InitialJobData = {
    requesterId: user.user_id,
    user_id: user.user_id,
    tenantId: tenant,
    invoiceIds,
    steps,
    metadata: {
      user_id: user.user_id,
      invoice_count: invoiceIds.length,
      tenantId: tenant,
    },
  };

  try {
    const { jobRecord, scheduledJobId } = await jobService.createAndScheduleJob('invoice_zip', jobData, 'immediate');
    if (!scheduledJobId) {
      throw new Error('Failed to schedule job - no job ID returned');
    }
    return { jobId: jobRecord.id };
  } catch (error) {
    logger.error('Failed to schedule invoice zip job', {
      error,
      userId: user.user_id,
      invoiceIds,
    });

    const errorMessage = error instanceof Error ? error.message : 'Failed to schedule invoice zip job';
    throw new Error(errorMessage);
  }
});

export const scheduleInvoiceEmailAction = withAuth(async (
  user,
  { tenant },
  invoiceIds: string[]
) => {
  const { knex } = await createTenantKnex();

  const jobService = await JobService.create();

  const invoiceDetails = await Promise.all(
    invoiceIds.map(async (invoiceId) => {
      const invoice = await getInvoiceForRendering(invoiceId);
      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }
      const client = await getClientById(knex, tenant, invoice.client_id);
      if (!client) {
        throw new Error(`Client not found for invoice ${invoice.invoice_number}`);
      }
      return {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        clientName: client.client_name,
      };
    })
  );

  const steps = invoiceDetails.flatMap(({ invoiceId, invoiceNumber, clientName }) => [
    {
      stepName: `PDF Generation for Invoice #${invoiceNumber} (${clientName})`,
      type: 'pdf_generation',
      metadata: { invoiceId, tenantId: tenant },
    },
    {
      stepName: `Email Sending for Invoice #${invoiceNumber} (${clientName})`,
      type: 'email_sending',
      metadata: { invoiceId, tenantId: tenant },
    },
  ]);

  const jobData = {
    invoiceIds,
    tenantId: tenant,
    user_id: user.user_id,
    steps,
    metadata: {
      user_id: user.user_id,
      invoice_count: invoiceIds.length,
      tenantId: tenant,
    },
  };

  try {
    const { jobRecord, scheduledJobId } = await jobService.createAndScheduleJob('invoice_email', jobData, 'immediate');
    if (!scheduledJobId) {
      throw new Error('Failed to schedule job - no job ID returned');
    }

    return { jobId: jobRecord.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to schedule invoice email job', {
      error: errorMessage,
      userId: user.user_id,
      invoiceIds,
      invoiceDetails: invoiceDetails?.map((d) => ({
        invoiceNumber: d.invoiceNumber,
        clientName: d.clientName,
      })),
    });
    throw new Error(errorMessage);
  }
});

export interface InvoiceEmailRecipientInfo {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;

  recipientEmail: string;
  recipientName: string;
  recipientSource: 'billing_contact' | 'billing_email' | 'client_email' | 'none';

  totalAmount: string;
  currencyCode: string;
  dueDate: string | null;
  invoiceDate: string | null;

  companyName: string;
  fromEmail: string;
}

export interface GetInvoiceEmailRecipientsResult {
  recipients: InvoiceEmailRecipientInfo[];
  errors: Array<{ invoiceId: string; error: string }>;
}

export const getInvoiceEmailRecipientAction = withAuth(async (
  user,
  { tenant },
  invoiceIds: string[]
): Promise<GetInvoiceEmailRecipientsResult> => {
  const { knex } = await createTenantKnex();

  if (!invoiceIds || invoiceIds.length === 0) {
    throw new Error('No invoice IDs provided');
  }

  const recipients: InvoiceEmailRecipientInfo[] = [];
  const errors: Array<{ invoiceId: string; error: string }> = [];

  const fromEmail = process.env.EMAIL_FROM || 'noreply@example.com';

  const tenantRecord = await knex('tenants').where({ tenant }).first();
  const companyName = tenantRecord?.company_name || 'Your Company';

  for (const invoiceId of invoiceIds) {
    try {
      const invoice = await getInvoiceForRendering(invoiceId);
      if (!invoice || !invoice.invoice_number) {
        errors.push({ invoiceId, error: `Invoice not found` });
        continue;
      }

      const client = await getClientById(knex, tenant, invoice.client_id);
      if (!client) {
        errors.push({ invoiceId, error: `Client not found` });
        continue;
      }

      let recipientEmail = '';
      let recipientName = client.client_name;
      let recipientSource: InvoiceEmailRecipientInfo['recipientSource'] = 'none';

      if (client.billing_contact_id) {
        const contact = await knex<IContact>('contacts')
          .where({ tenant, contact_name_id: client.billing_contact_id })
          .first();
        if (contact && contact.email) {
          recipientEmail = contact.email;
          recipientName = contact.full_name;
          recipientSource = 'billing_contact';
        }
      }

      if (!recipientEmail && (client as any).billing_email) {
        recipientEmail = (client as any).billing_email;
        recipientSource = 'billing_email';
      }

      if (!recipientEmail && (client as any).location_email) {
        recipientEmail = (client as any).location_email;
        recipientSource = 'client_email';
      }

      const currencyCode = (invoice as any).currencyCode || 'USD';
      const totalAmount = formatCurrency(invoice.total_amount / 100, 'en-US', currencyCode);

      const invoiceDate = invoice.invoice_date
        ? dateValueToDate(invoice.invoice_date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : null;

      const dueDate = invoice.due_date
        ? dateValueToDate(invoice.due_date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : null;

      recipients.push({
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        clientName: client.client_name,
        recipientEmail,
        recipientName,
        recipientSource,
        totalAmount,
        currencyCode,
        dueDate,
        invoiceDate,
        companyName,
        fromEmail,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ invoiceId, error: errorMessage });
    }
  }

  return { recipients, errors };
});

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

async function getInvoiceEmailTemplate(knex: any, tenant: string): Promise<InvoiceEmailTemplate> {
  let template = await knex('tenant_email_templates')
    .where({
      tenant,
      name: 'invoice-email',
      language_code: 'en',
    })
    .first();

  if (!template) {
    template = await knex('system_email_templates')
      .where({
        name: 'invoice-email',
        language_code: 'en',
      })
      .first();
  }

  if (!template) {
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
{{company.name}}`,
    };
  }

  return {
    subject: template.subject,
    html_content: template.html_content,
    text_content: template.text_content,
  };
}

export const sendInvoiceEmailAction = withAuth(async (
  user,
  { tenant },
  invoiceIds: string[],
  customMessage?: string
): Promise<SendInvoiceEmailsResult> => {
  const { knex } = await createTenantKnex();

  if (!invoiceIds || invoiceIds.length === 0) {
    throw new Error('No invoice IDs provided');
  }

  const emailProvider = await SystemEmailProviderFactory.createProvider();
  if (!emailProvider) {
    throw new Error('Email is not configured. Please configure email settings in Settings before sending invoices.');
  }

  const pdfService = createPDFGenerationService(tenant);
  const results: SendInvoiceEmailResult[] = [];

  const tenantRecord = await knex('tenants').where({ tenant }).first();
  const companyName = tenantRecord?.company_name || 'Your Company';
  const fromEmail = process.env.EMAIL_FROM || 'noreply@example.com';

  for (const invoiceId of invoiceIds) {
    let tempPdfPath: string | null = null;

    try {
      const invoice = await getInvoiceForRendering(invoiceId);
      if (!invoice || !invoice.invoice_number) {
        results.push({
          success: false,
          invoiceNumber: invoiceId,
          recipientEmail: '',
          error: `Invoice ${invoiceId} not found`,
        });
        continue;
      }

      const client = await getClientById(knex, tenant, invoice.client_id);
      if (!client) {
        results.push({
          success: false,
          invoiceNumber: invoice.invoice_number,
          recipientEmail: '',
          error: `Client not found for invoice ${invoice.invoice_number}`,
        });
        continue;
      }

      let recipientEmail = (client as any).location_email || '';
      let recipientName = client.client_name;

      if (client.billing_contact_id) {
        const contact = await knex<IContact>('contacts')
          .where({ tenant, contact_name_id: client.billing_contact_id })
          .first();
        if (contact) {
          recipientEmail = contact.email;
          recipientName = contact.full_name;
        }
      } else if ((client as any).billing_email) {
        recipientEmail = (client as any).billing_email;
      }

      if (!isValidEmail(recipientEmail)) {
        results.push({
          success: false,
          invoiceNumber: invoice.invoice_number,
          recipientEmail: recipientEmail || '',
          error: `No valid email address found for ${client.client_name}`,
        });
        continue;
      }

      logger.info('[sendInvoiceEmailAction] Generating PDF', {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
      });

      const { file_id } = await pdfService.generateAndStore({
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        version: 1,
        userId: user.user_id,
      });

      const { buffer } = await StorageService.downloadFile(file_id);
      tempPdfPath = `/tmp/invoice_${invoice.invoice_number}_${Date.now()}.pdf`;
      await fs.writeFile(tempPdfPath, buffer);
      const pdfBuffer = await fs.readFile(tempPdfPath);

      const currencyCode = (invoice as any).currencyCode || 'USD';
      const totalAmount = formatCurrency(invoice.total_amount / 100, 'en-US', currencyCode);

      const invoiceDate = invoice.invoice_date
        ? dateValueToDate(invoice.invoice_date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'N/A';

      const dueDate = invoice.due_date
        ? dateValueToDate(invoice.due_date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : 'N/A';

      const emailTemplate = await getInvoiceEmailTemplate(knex, tenant);
      const templateContext = {
        invoice: {
          number: invoice.invoice_number,
          amount: totalAmount,
          invoiceDate,
          dueDate,
        },
        client: {
          name: client.client_name,
        },
        recipient: {
          name: recipientName,
          email: recipientEmail,
        },
        company: {
          name: companyName,
        },
        customMessage: customMessage || '',
      };

      const subject = Handlebars.compile(emailTemplate.subject)(templateContext);
      const html = Handlebars.compile(emailTemplate.html_content)(templateContext);
      const text = Handlebars.compile(emailTemplate.text_content)(templateContext);

      const from: EmailAddress = { email: fromEmail, name: companyName };
      const to: EmailAddress[] = [{ email: recipientEmail, name: recipientName }];

      const message: EmailMessage = {
        from,
        to,
        subject,
        html,
        text,
        attachments: [
          {
            filename: `Invoice_${invoice.invoice_number}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      };

      logger.info('[sendInvoiceEmailAction] Sending email', {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        to: recipientEmail,
      });

      await emailProvider.sendEmail(message, tenant);

      results.push({
        success: true,
        invoiceNumber: invoice.invoice_number,
        recipientEmail,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.push({
        success: false,
        invoiceNumber: invoiceId,
        recipientEmail: '',
        error: errorMessage,
      });
    } finally {
      if (tempPdfPath) {
        try {
          await fs.unlink(tempPdfPath);
        } catch {
          // ignore
        }
      }
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;

  return { results, successCount, failureCount };
});
