import { JobService, JobStepResult } from 'server/src/services/job.service';
import { runAsJobActingUser } from './jobActingUser';
import { PDFGenerationService, createPDFGenerationService, publishGeneratedDocumentsToClient } from '@alga-psa/billing/services';
import { resolveInvoiceBillingRecipient } from '@alga-psa/billing/services';
import { StaticTemplateProcessor, TenantEmailService } from '@alga-psa/email';
import { StorageService } from '@alga-psa/storage/StorageService';
import { getConnection } from 'server/src/lib/db/db';
import { tenantDb } from '@alga-psa/db';
import { JobStatus } from 'server/src/types/job';
import { getInvoiceEmailLinkContext } from '@alga-psa/billing/actions/invoiceEmailLinkContext';
import { fetchTenantParty } from '@alga-psa/billing/lib/adapters/tenantPartyAdapter';
import logger from '@alga-psa/core/logger';

/**
 * Gets the tenant company name for email templates.
 */
async function getTenantCompanyName(tenantId: string): Promise<string> {
  try {
    const knex = await getConnection();
    const party = await fetchTenantParty(knex, tenantId);
    return party?.name || 'Your Company';
  } catch {
    return 'Your Company';
  }
}

// Direct reads: this handler runs inside a background job with no request
// scope, so withAuth actions (which resolve the user from request headers)
// cannot be called here.

type JobInvoiceRow = Record<string, any> & {
  invoice_id: string;
  invoice_number: string | null;
  client_id: string;
  /** Which of the client's billing profiles this invoice bills, if segmented. */
  billing_profile_id?: string | null;
};

async function getInvoiceRow(tenantId: string, invoiceId: string): Promise<JobInvoiceRow | undefined> {
  const knex = await getConnection();
  const row = await tenantDb(knex, tenantId).table('invoices')
    .where({ invoice_id: invoiceId })
    .first<JobInvoiceRow | undefined>();
  if (row) {
    // The email template reads the view-model field name.
    row.currencyCode = row.currency_code;
  }
  return row;
}

async function getClientRow(
  tenantId: string,
  clientId: string
): Promise<{ client_name: string; location_address: string | null } | undefined> {
  const knex = await getConnection();
  const db = tenantDb(knex, tenantId);
  const query = db.table('clients as c').where('c.client_id', clientId);
  db.tenantJoin(query, 'client_locations as cl', 'c.client_id', 'cl.client_id', {
    type: 'left',
    on(join) {
      join.andOn('cl.is_default', '=', knex.raw('true'));
    },
  });
  return query.first('c.client_name', 'cl.address_line1 as location_address');
}

export interface InvoiceEmailJobData extends Record<string, unknown> {
  jobServiceId: string;
  tenantId: string;
  invoiceIds: string[];
  senderId?: string;
  steps: {
    stepName: string;
    type: string;
    metadata: {
      invoiceId?: string;
      tenantId: string;
    };
  }[];
  metadata: {
    user_id: string;
    tenantId: string;
  };
}

export class InvoiceEmailHandler {
  static async handle(pgBossJobId: string, data: InvoiceEmailJobData) {
    if (!data.jobServiceId) {
      throw new Error('jobServiceId is required in job data');
    }
    if (!data.tenantId) throw new Error('Tenant ID is required');

    // Background execution has no session; act as the user who enqueued the
    // job so the withAuth actions below (invoice rendering, client lookup)
    // resolve an identity and permissions.
    return runAsJobActingUser(
      {
        jobName: 'invoice_email',
        tenantId: data.tenantId,
        userId: (data as { user_id?: string }).user_id ?? data.metadata?.user_id,
      },
      () => InvoiceEmailHandler.execute(pgBossJobId, data)
    );
  }

  private static async execute(pgBossJobId: string, data: InvoiceEmailJobData) {
    const { tenantId, jobServiceId, invoiceIds, steps } = data;
    if (!invoiceIds || !invoiceIds.length) throw new Error('No invoice IDs provided');
    
    console.log(`Starting invoice email job: Processing ${invoiceIds.length} invoice(s) for tenant ${tenantId}`);

    const jobService = await JobService.create();
    // Use the factory function to create the PDF generation service
    const pdfService = createPDFGenerationService(tenantId);

    try {
      // Process each invoice
      for (let i = 0; i < invoiceIds.length; i++) {
        // Track job detail IDs for error handling for this invoice only
        let pdfDetailId: string | undefined;
        let emailDetailId: string | undefined;
        const invoiceId = invoiceIds[i];
        const pdfStep = steps[i * 2]; // PDF generation step
        const emailStep = steps[i * 2 + 1]; // Email sending step

        try {
          // Get invoice details first for better logging
          const invoice = await getInvoiceRow(tenantId, invoiceId);
          if (!invoice || !invoice.invoice_number) {
            throw new Error(`Failed to get details for Invoice ID ${invoiceId}`);
          }

          const client = await getClientRow(tenantId, invoice.client_id);
          if (!client) {
            throw new Error(`Client not found for Invoice #${invoice.invoice_number}`);
          }

          const knex = await getConnection(tenantId);

          // Resolve the billing recipient with the shared precedence used by
          // the direct MSP send action and Stripe customer creation.
          const resolved = await resolveInvoiceBillingRecipient({
            knexOrTrx: knex,
            tenantId,
            clientId: invoice.client_id,
            billingProfileId: invoice.billing_profile_id ?? null,
          });

          let recipientEmail = resolved.recipientEmail;
          let recipientName = resolved.recipientName || client.client_name;

          if (!recipientEmail) {
            throw new Error(`No valid email address found for ${client.client_name} (Invoice #${invoice.invoice_number})`);
          }

          // Create initial job detail records for both steps
          pdfDetailId = await jobService.createJobDetail(
            jobServiceId,
            pdfStep.stepName,
            'pending',
            {
              invoiceId,
              details: `Preparing to generate PDF for Invoice #${invoice.invoice_number} (${client.client_name})`
            }
          );

          emailDetailId = await jobService.createJobDetail(
            jobServiceId,
            emailStep.stepName,
            'pending',
            {
              invoiceId,
              recipientEmail,
              details: `Preparing to send Invoice #${invoice.invoice_number} to ${recipientName} (${recipientEmail}) at ${client.client_name}`
            }
          );

          // Start PDF generation
          const pdfProcessingDetails = {
            invoiceId,
            details: `Generating PDF for Invoice #${invoice.invoice_number} (${client.client_name})`
          };

          await jobService.updateJobDetailRecord(
            pdfDetailId,
            'processing',
            pdfProcessingDetails
          );

          await jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
            tenantId,
            pgBossJobId,
            stepResult: {
              step: pdfStep.type,
              status: 'started',
              ...pdfProcessingDetails
            }
          });

          // Generate PDF with invoice number
          const { file_id } = await pdfService.generateAndStore({
            invoiceId,
            invoiceNumber: invoice.invoice_number,
            version: 1,
            userId: data.metadata?.user_id || 'system'
          });

          const pdfCompleteDetails = {
            invoiceId,
            file_id,
            details: `Generated PDF for Invoice #${invoice.invoice_number} (${client.client_name})`
          };

          // Update the existing job detail record for PDF generation
          await jobService.updateJobDetailRecord(
            pdfDetailId,
            'completed',
            pdfCompleteDetails
          );

          await jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
            tenantId,
            pgBossJobId,
            stepResult: {
              step: pdfStep.type,
              status: 'completed',
              ...pdfCompleteDetails
            }
          });

          // Start email sending
          const emailProcessingDetails = {
            invoiceId,
            recipientEmail,
            details: `Sending Invoice #${invoice.invoice_number} to ${recipientName} (${recipientEmail}) at ${client.client_name}`
          };

          await jobService.updateJobDetailRecord(
            emailDetailId,
            'processing',
            emailProcessingDetails
          );

          await jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
            tenantId,
            pgBossJobId,
            stepResult: {
              step: emailStep.type,
              status: 'started',
              ...emailProcessingDetails
            }
          });
          // Update invoice contact info
          invoice.contact = {
            name: recipientName,
            address: client.location_address || ''
          };

          // Get the PDF content and send email
          const { buffer } = await StorageService.downloadFile(file_id);
          {
            // Build the shared invoice-email link context (payment + portal
            // URLs). Link failures never fail the email; the retained error is
            // logged and the email falls back to the portal CTA.
            const linkContext = await getInvoiceEmailLinkContext(tenantId, {
              invoice_id: invoice.invoice_id,
              status: invoice.status,
              finalized_at: invoice.finalized_at,
              invoice_type: invoice.invoice_type,
              total_amount: invoice.total_amount,
              credit_applied: invoice.credit_applied,
            });

            if (linkContext.paymentError) {
              logger.warn('[InvoiceEmailHandler] Failed to generate payment link', {
                tenantId,
                invoiceId,
                error: linkContext.paymentError,
              });
            }
            if (linkContext.paymentUrl) {
              logger.info('[InvoiceEmailHandler] Generated payment link', {
                tenantId,
                invoiceId,
              });
            }

            // Get tenant company name for email template
            const companyName = await getTenantCompanyName(tenantId);

            const currencyCode = invoice.currencyCode || 'USD';
            const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(
              ((invoice.total_amount || 0) - (invoice.credit_applied || 0)) / 100
            );
            const subject = `Invoice ${invoice.invoice_number} from ${companyName}`;
            const html = `<p>Dear ${client.client_name},</p><p>Please find attached your invoice ${invoice.invoice_number} for ${amount}.</p>${linkContext.paymentUrl ? `<p><a href="${linkContext.paymentUrl}">Pay invoice</a></p>` : ''}${linkContext.portalUrl ? `<p><a href="${linkContext.portalUrl}">View invoice in the client portal</a></p>` : ''}<p>Thank you for your business!</p><p>Best regards,<br>${companyName}</p>`;
            const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const sendResult = await TenantEmailService.getInstance(tenantId).sendEmail({
              tenantId,
              mailClass: 'billing',
              senderId: data.senderId,
              to: { email: recipientEmail, name: recipientName },
              templateProcessor: new StaticTemplateProcessor(subject, html, text),
              attachments: [{ filename: `invoice_${invoice.invoice_number}.pdf`, content: buffer, contentType: 'application/pdf' }],
              entityType: 'invoice',
              entityId: invoiceId,
              userId: data.metadata?.user_id,
            });
            if (!sendResult.success || sendResult.queued) throw new Error(sendResult.error || 'Failed to send invoice email');

            // The invoice has reached the client, so the filed document may now
            // be shown in the client portal.
            await publishGeneratedDocumentsToClient(tenantId, 'invoice', invoiceId).catch((visibilityError) => {
              logger.warn('[InvoiceEmailHandler] Failed to publish invoice document to client', {
                tenantId,
                invoiceId,
                error: visibilityError instanceof Error ? visibilityError.message : 'Unknown error',
              });
            });

            const emailCompleteDetails = {
              invoiceId,
              recipientEmail,
              details: `Successfully sent Invoice #${invoice.invoice_number} to ${recipientName} at ${client.client_name}`
            };

            // Update the existing job detail record for email sending
            await jobService.updateJobDetailRecord(
              emailDetailId,
              'completed',
              emailCompleteDetails
            );

            await jobService.updateJobStatus(jobServiceId, JobStatus.Processing, {
              tenantId,
              pgBossJobId,
              stepResult: {
                step: emailStep.type,
                status: 'completed',
                ...emailCompleteDetails
              }
            });

          }

        } catch (error) {
          console.log('failed to process invoice:', error);
          const invoice = await getInvoiceRow(tenantId, invoiceId).catch(() => undefined);
          const client = invoice ? await getClientRow(tenantId, invoice.client_id).catch(() => undefined) : undefined;
          const invoiceNumber = invoice?.invoice_number || invoiceId;
          const clientName = client?.client_name || 'Unknown Client';

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const contextualError = `Failed to process Invoice #${invoiceNumber} for ${clientName}: ${errorMessage}`;
          
          // Record the failure in job_details
          // Update existing job detail records to failed status
          if (pdfDetailId) {
            await jobService.updateJobDetailRecord(
              pdfDetailId,
              'failed',
              {
                error: contextualError,
                invoiceId,
                invoiceNumber,
                clientName
              }
            );
          }
          if (emailDetailId) {
            await jobService.updateJobDetailRecord(
              emailDetailId,
              'failed',
              {
                error: contextualError,
                invoiceId,
                invoiceNumber,
                clientName
              }
            );
          }

          await jobService.updateJobStatus(jobServiceId, JobStatus.Failed, {
            tenantId,
            pgBossJobId,
            error: contextualError
          });
          throw error;
        }
      }

      // All invoices processed successfully
      await jobService.updateJobStatus(jobServiceId, JobStatus.Completed, {
        tenantId,
        pgBossJobId,
        details: `Successfully processed ${invoiceIds.length} invoice(s)`
      });

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await jobService.updateJobStatus(jobServiceId, JobStatus.Failed, {
        error: errorMessage,
        tenantId,
        pgBossJobId
      });
      throw error;
    }
  }
}
