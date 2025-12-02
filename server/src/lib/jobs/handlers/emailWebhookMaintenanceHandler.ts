import { Job } from 'pg-boss';
import { EmailWebhookMaintenanceService } from '@alga-psa/shared/services/email/EmailWebhookMaintenanceService';
import logger from '@shared/core/logger';

export interface EmailWebhookMaintenanceJobData {
  tenantId?: string;
  lookAheadMinutes?: number;
  [key: string]: unknown; // Added index signature
}

export async function emailWebhookMaintenanceHandler(job: Job<EmailWebhookMaintenanceJobData>) {
  try {
    logger.info('Starting email webhook maintenance job');
    const service = new EmailWebhookMaintenanceService();
    
    const { tenantId, lookAheadMinutes } = job.data || {};
    const results = await service.renewMicrosoftWebhooks({ tenantId, lookAheadMinutes });
    
    logger.info(`Email webhook maintenance job completed. Processed ${results.length} providers.`);
    return { success: true, results };
  } catch (error: any) {
    logger.error('Email webhook maintenance job failed', error);
    throw error;
  }
}

