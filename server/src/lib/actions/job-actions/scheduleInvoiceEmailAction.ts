'use server'

import { JobService } from '@/services/job.service';
import { createTenantKnex } from '@/lib/db';

export const scheduleInvoiceEmailAction = async (invoiceIds: string[]) => {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');
  
  const jobService = new JobService(knex);
  
  // Create a job with two steps per invoice:
  // 1. PDF Generation
  // 2. Email Sending
  const jobId = await jobService.createJob(
    'invoice_email',
    { invoiceIds },
    invoiceIds.flatMap(invoiceId => [
      {
        stepName: `Generate PDF for Invoice ${invoiceId}`,
        type: 'pdf_generation',
        metadata: { invoiceId }
      },
      {
        stepName: `Send Email for Invoice ${invoiceId}`,
        type: 'email_sending', 
        metadata: { invoiceId }
      }
    ])
  );

  return { jobId };
};
