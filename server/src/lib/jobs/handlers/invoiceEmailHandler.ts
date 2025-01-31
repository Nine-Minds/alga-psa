import { JobService } from '@/services/job.service';
import { PDFGenerationService } from '@/services/pdf-generation.service';
import { EmailService } from '@/utils/email/emailService';
import { StorageService } from '@/lib/storage/StorageService';
import Invoice from '@/lib/models/invoice';
import { createTenantKnex } from '@/lib/db';
import { getCompanyById } from '@/lib/actions/companyActions';
import ContactModel from '@/lib/models/contact';
import fs from 'fs/promises';

enum JobStatus {
  Pending = 'pending',
  Completed = 'completed',
  Failed = 'failed'
}

export class InvoiceEmailHandler {
  static async handle(jobId: string, stepId: string) {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) throw new Error('Tenant not found');
    const storageService = new StorageService();
    const jobService = new JobService(knex);
    const job = await jobService.getJobProgress(jobId);
    const { invoiceId } = job.header.metadata;

    try {
      // Step 1: Generate PDF
      if (job.details[0].status === JobStatus.Pending) {
        const pdfService = new PDFGenerationService(storageService, {
          pdfCacheDir: process.env.PDF_CACHE_DIR,
          tenant
        });
        const { file_id } = await pdfService.generateAndStore({
          invoiceId
        });
        await jobService.updateStepStatus(jobId, stepId, JobStatus.Completed, { file_id });
      }

      // Step 2: Send Email
      if (job.details[1].status === JobStatus.Pending) {
        const invoice = await Invoice.getFullInvoiceById(invoiceId);
        const emailService = new EmailService();
        
        // Get full company details
        const company = await getCompanyById(invoice.company_id);
        if (!company) {
          throw new Error('Company not found');
        }

        // Determine recipient email with priority order:
        // 1. Billing contact's email
        // 2. Company's billing email
        // 3. Company's primary email
        let recipientEmail = company.email; // Default fallback
        let recipientName = company.company_name;

        if (company.billing_contact_id) {
          const contact = await ContactModel.get(company.billing_contact_id);
          if (contact) {
            recipientEmail = contact.email;
            recipientName = contact.full_name;
          }
        } else if (company.billing_email) {
          recipientEmail = company.billing_email;
        }

        if (!recipientEmail) {
          throw new Error('No valid email address found for invoice recipient');
        }
        
        // Update invoice contact info
        invoice.contact = {
          name: recipientName,
          address: company.address || ''
        };
        
        // Get the PDF content from storage service
        const { buffer } = await StorageService.downloadFile(tenant, job.details[0].result.file_id);
        
        // Create a temporary file path for the PDF
        const tempPath = `/tmp/invoice_${invoice.invoice_number}_${Date.now()}.pdf`;
        await fs.writeFile(tempPath, buffer);
        
        try {
          // Create a modified invoice view model with the recipient email
          const emailInvoice = {
            ...invoice,
            company: {
              name: company.company_name,
              logo: '',
              address: company.address || ''
            },
            recipientEmail  // Include the determined recipient email
          };
          
          await emailService.sendInvoiceEmail(emailInvoice, tempPath);
        } finally {
          // Clean up temporary file
          await fs.unlink(tempPath);
        }

        await jobService.updateStepStatus(jobId, stepId, JobStatus.Completed, { sent: true });
      }

      // Mark job as completed if all steps are done
      if (job.details.every(d => d.status === JobStatus.Completed)) {
        await jobService.updateJobStatus(jobId, JobStatus.Completed, { completed: true });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await jobService.updateJobStatus(jobId, JobStatus.Failed, { error: errorMessage });
      throw error;
    }
  }
}
