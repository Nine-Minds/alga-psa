import { JobService } from '@/services/job.service';
import { PDFGenerationService } from '@/services/pdf-generation.service';
import { EmailService } from '@/utils/email/emailService';
import { StorageService } from '@/lib/storage/StorageService';
import Invoice from '@/lib/models/invoice';
import { createTenantKnex } from '@/lib/db';

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
        
        const recipientEmail = (invoice.company.contact?.email || invoice.company.email || 'billing@example.com') as string;
        await emailService.sendInvoiceEmail({
          to: recipientEmail,
          subject: `Invoice ${invoice.invoice_number}`,
          text: `Please find attached invoice ${invoice.invoice_number}`,
          attachments: [{
            filename: `invoice_${invoice.invoice_number}.pdf`,
            path: job.details[0].result.file_id
          }]
        });

        await jobService.updateStepStatus(jobId, stepId, JobStatus.Completed);
      }

      // Mark job as completed if all steps are done
      if (job.details.every(d => d.status === JobStatus.Completed)) {
        await jobService.updateJobStatus(jobId, JobStatus.Completed);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await jobService.updateJobStatus(jobId, JobStatus.Failed, { error: errorMessage });
      throw error;
    }
  }
}
