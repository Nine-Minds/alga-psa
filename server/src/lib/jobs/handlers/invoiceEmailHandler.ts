import { JobService, JobStepResult } from 'server/src/services/job.service';
import { PDFGenerationService, createPDFGenerationService, publishGeneratedDocumentsToClient } from '@alga-psa/billing/services';
import { resolveInvoiceBillingRecipient } from '@alga-psa/billing/services';
import { getEmailService } from 'server/src/services/emailService';
import { StorageService } from '@alga-psa/storage/StorageService';
import fs from 'fs/promises';
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

    const { tenantId, jobServiceId, invoiceIds, steps } = data;
    if (!tenantId) throw new Error('Tenant ID is required');
    if (!invoiceIds || !invoiceIds.length) throw new Error('No invoice IDs provided');
    
    console.log(`Starting invoice email job: Processing ${invoiceIds.length} invoice(s) for tenant ${tenantId}`);

    const jobService = await JobService.create();
    const emailService = await getEmailService();
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

          const knex = await getConnection();

          // Resolve the billing recipient with the shared precedence used by
          // the direct MSP send action and Stripe customer creation.
          const resolved = await resolveInvoiceBillingRecipient({
            knexOrTrx: knex,
            tenantId,
            clientId: invoice.client_id,
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
          const tempPath = `/tmp/invoice_${invoice.invoice_number}_${Date.now()}.pdf`;
          await fs.writeFile(tempPath, buffer);

          try {
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

            // Send email using the new email service. The raw invoice row
            // carries every column the template reads; the view-model type
            // names them individually, which an index signature cannot satisfy.
            const success = await emailService.sendInvoiceEmail(
              {
                ...(invoice as unknown as import('server/src/interfaces/invoice.interfaces').InvoiceViewModel),
                recipientEmail,
                tenantId,
                client: {
                  name: client.client_name,
                  logo: '',
                  address: client.location_address || ''
                }
              },
              tempPath,
              {
                paymentLink: linkContext.paymentUrl,
                portalLink: linkContext.portalUrl,
                companyName,
              }
            );

            if (!success) {
              throw new Error('Failed to send invoice email');
            }

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

          } finally {
            // Clean up temporary file
            await fs.unlink(tempPath);
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
