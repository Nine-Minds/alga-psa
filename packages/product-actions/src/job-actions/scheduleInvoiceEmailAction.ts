'use server'

import { JobService } from 'server/src/services/job.service';
import { createTenantKnex } from '@server/lib/db';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { getInvoiceForRendering } from '@product/actions/invoiceQueries';
import { getClientById } from '@product/actions/client-actions/clientActions';
import { JobStatus } from 'server/src/types/job';
import logger from '@shared/core/logger';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { analytics } from '@server/lib/analytics/posthog';
import { AnalyticsEvents } from '@server/lib/analytics/events';

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
      const client = await getClientById(invoice.client_id);
      if (!client) {
        throw new Error(`Client not found for invoice ${invoice.invoice_number}`);
      }
      return {
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        clientName: client.client_name
      };
    })
  );

  const steps = invoiceDetails.flatMap(({ invoiceId, invoiceNumber, clientName }) => [
    {
      stepName: `PDF Generation for Invoice #${invoiceNumber} (${clientName})`,
      type: 'pdf_generation',
      metadata: { invoiceId, tenantId: tenant }
    },
    {
      stepName: `Email Sending for Invoice #${invoiceNumber} (${clientName})`,
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

    // Track analytics for each invoice sent
    for (const detail of invoiceDetails) {
      analytics.capture(AnalyticsEvents.INVOICE_SENT, {
        invoice_id: detail.invoiceId,
        invoice_number: detail.invoiceNumber,
        client_name: detail.clientName,
        batch_size: invoiceIds.length,
        job_id: jobRecord.id
      }, currentUser.user_id);
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
        clientName: d.clientName
      }))
    });
    
    // Preserve the original error message
    throw new Error(errorMessage);
  }
};
