import { CalendarWebhookMaintenanceService } from 'server/src/services/calendar/CalendarWebhookMaintenanceService';

export async function renewMicrosoftCalendarWebhooksActivity(options: { tenantId?: string; lookAheadMinutes?: number }): Promise<any[]> {
  const service = new CalendarWebhookMaintenanceService();
  return service.renewMicrosoftWebhooks(options);
}

