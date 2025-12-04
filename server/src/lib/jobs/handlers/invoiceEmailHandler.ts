import { JobService, JobStepResult } from 'server/src/services/job.service';
import { PDFGenerationService, createPDFGenerationService } from 'server/src/services/pdf-generation.service';
import { getEmailService } from 'server/src/services/emailService';
import { StorageService } from 'server/src/lib/storage/StorageService';
import Invoice from 'server/src/lib/models/invoice';
import { createTenantKnex } from 'server/src/lib/db';
import { getClientById } from 'server/src/lib/actions/client-actions/clientActions';
import ContactModel from 'server/src/lib/models/contact';
import fs from 'fs/promises';
import { getConnection } from 'server/src/lib/db/db';
import { JobStatus } from 'server/src/types/job';
import { getInvoiceForRendering } from 'server/src/lib/actions/invoiceQueries';
import logger from '@alga-psa/shared/core/logger';

/**
 * Dynamically imports the PaymentService (EE only).
 * Returns null if not available (CE edition).
 */
async function getPaymentService(tenantId: string): Promise<any | null> {
  const isEE = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  if (!isEE) return null;

  try {
    const { PaymentService } = await import('@ee/lib/payments');
    return PaymentService.create(tenantId);
  } catch (error) {
    logger.debug('[InvoiceEmailHandler] PaymentService not available', { error });
    return null;
  }
}

/**
 * Gets the tenant company name for email templates.
 */
async function getTenantCompanyName(tenantId: string): Promise<string> {
  try {
    const knex = await getConnection();
    const tenant = await knex('tenants')
      .where({ tenant: tenantId })
      .first();
    return tenant?.company_name || 'Your Company';
  } catch {
    return 'Your Company';
  }
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
    
    // Track job detail IDs for error handling
    let pdfDetailId: string | undefined;
    let emailDetailId: string | undefined;
    
    console.log(`Starting invoice email job: Processing ${invoiceIds.length} invoice(s) for tenant ${tenantId}`);

    const jobService = await JobService.create();
    const emailService = await getEmailService();
    // Use the factory function to create the PDF generation service
    const pdfService = createPDFGenerationService(tenantId);

    try {
      // Process each invoice
      for (let i = 0; i < invoiceIds.length; i++) {
        const invoiceId = invoiceIds[i];
        const pdfStep = steps[i * 2]; // PDF generation step
        const emailStep = steps[i * 2 + 1]; // Email sending step

        try {
          // Get invoice details first for better logging
          const invoice = await getInvoiceForRendering(invoiceId);
          if (!invoice || !invoice.invoice_number) {
            throw new Error(`Failed to get details for Invoice ID ${invoiceId}`);
          }

          const client = await getClientById(invoice.client_id);
          if (!client) {
            throw new Error(`Client not found for Invoice #${invoice.invoice_number}`);
          }

          // Determine recipient email with priority order first
          let recipientEmail = client.location_email || '';
          let recipientName = client.client_name;

          if (client.billing_contact_id) {
            const knex = await createTenantKnex();
            const contact = await ContactModel.get(knex.knex, client.billing_contact_id);
            if (contact) {
              recipientEmail = contact.email;
              recipientName = contact.full_name;
            }
          } else if (client.billing_email) {
            recipientEmail = client.billing_email;
          }

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
            // Try to generate a payment link if PaymentService is available
            let paymentLinkUrl: string | undefined;
            if (invoice.status !== 'paid' && invoice.status !== 'cancelled') {
              try {
                const paymentService = await getPaymentService(tenantId);
                if (paymentService) {
                  const hasProvider = await paymentService.hasEnabledProvider();
                  if (hasProvider) {
                    const settings = await paymentService.getPaymentSettings();
                    if (settings.paymentLinksInEmails) {
                      const paymentLink = await paymentService.getOrCreatePaymentLink(invoiceId);
                      if (paymentLink) {
                        paymentLinkUrl = paymentLink.url;
                        logger.info('[InvoiceEmailHandler] Generated payment link', {
                          tenantId,
                          invoiceId,
                          paymentLinkId: paymentLink.paymentLinkId,
                        });
                      }
                    }
                  }
                }
              } catch (paymentError) {
                // Don't fail the email if payment link generation fails
                logger.warn('[InvoiceEmailHandler] Failed to generate payment link', {
                  tenantId,
                  invoiceId,
                  error: paymentError instanceof Error ? paymentError.message : 'Unknown error',
                });
              }
            }

            // Get tenant company name for email template
            const companyName = await getTenantCompanyName(tenantId);

            // Send email using the new email service
            const success = await emailService.sendInvoiceEmail(
              {
                ...invoice,
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
                paymentLink: paymentLinkUrl,
                companyName,
              }
            );

            if (!success) {
              throw new Error('Failed to send invoice email');
            }

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
          const invoice = await getInvoiceForRendering(invoiceId);
          const client = invoice ? await getClientById(invoice.client_id) : null;
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
      
      // Update any existing job details to failed status
      if (pdfDetailId) {
        await jobService.updateJobDetailRecord(
          pdfDetailId,
          'failed',
          {
            error: errorMessage,
            details: 'Failed to process invoice email job'
          }
        );
      }
      if (emailDetailId) {
        await jobService.updateJobDetailRecord(
          emailDetailId,
          'failed',
          {
            error: errorMessage,
            details: 'Failed to process invoice email job'
          }
        );
      }

      await jobService.updateJobStatus(jobServiceId, JobStatus.Failed, {
        error: errorMessage,
        tenantId,
        pgBossJobId
      });
      throw error;
    }
  }
}
