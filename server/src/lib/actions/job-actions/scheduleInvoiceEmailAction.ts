'use server'

import { JobService } from 'server/src/services/job.service';
import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from '../user-actions/userActions';
import { getInvoiceForRendering } from '../invoiceActions';
import { getCompanyById } from '../companyActions';
import { JobStatus } from 'server/src/types/job.d';
import logger from '@shared/core/logger';

export const scheduleInvoiceEmailAction = async (invoiceIds: string[]) => {
  const { tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();
  if (!tenant || !currentUser) throw new Error('Tenant or user not found');

  const jobService = await JobService.create();
  // Fetch invoice details for human-readable names
  const invoiceDetails = await Promise.all(
    invoiceIds.map(async (invoiceId) => {
      const invoice = await getInvoiceForRendering(invoiceId);
      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }
      const company = await getCompanyById(invoice.company_id);
      if (!company) {
        throw new Error(`Company not found for invoice ${invoice.invoice_number}`);
      }
      return {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        companyName: company.company_name
      };
    })
  );

  const steps = invoiceDetails.flatMap(({ invoiceId, invoiceNumber, companyName }) => [
    {
      stepName: `PDF Generation for Invoice #${invoiceNumber} (${companyName})`,
      type: 'pdf_generation',
      metadata: { invoiceId, tenantId: tenant }
    },
    {
      stepName: `Email Sending for Invoice #${invoiceNumber} (${companyName})`,
      type: 'email_sending',
      metadata: { invoiceId, tenantId: tenant }
    }
  ]);

  const jobData = {
    invoiceIds,
    tenantId: tenant,
    user_id: currentUser.user_id,
    steps,
    metadata: {
      user_id: currentUser.user_id,
      invoice_count: invoiceIds.length,
      tenantId: tenant
    }
  };

  try {
    const { jobRecord, scheduledJobId } = await jobService.createAndScheduleJob(
      'invoice_email',
      jobData,
      'immediate'
    );
    if (!scheduledJobId) {
      throw new Error('Failed to schedule job - no job ID returned');
    }
    return { jobId: jobRecord.id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to schedule invoice email job', {
      error: errorMessage,
      userId: currentUser.user_id,
      invoiceIds,
      // Include human-readable details in the error log if available
      invoiceDetails: invoiceDetails?.map(d => ({
        invoiceNumber: d.invoiceNumber,
        companyName: d.companyName
      }))
    });
    throw new Error(`Failed to schedule invoice email job: ${errorMessage}`);
  }
};
