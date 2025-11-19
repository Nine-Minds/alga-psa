import { EmailWebhookMaintenanceService } from '@alga-psa/shared/services/email/EmailWebhookMaintenanceService';

export async function renewMicrosoftWebhooksActivity(options: { tenantId?: string; lookAheadMinutes?: number }): Promise<any[]> {
  const service = new EmailWebhookMaintenanceService();
  return service.renewMicrosoftWebhooks(options);
}

