import { Context } from '@temporalio/activity';

export async function renewMicrosoftCalendarWebhooksActivity(options: { tenantId?: string; lookAheadMinutes?: number }): Promise<any[]> {
  const log = Context.current().log;
  log.warn(
    'Calendar webhook maintenance is not implemented in ee/temporal-workflows (server-free build); skipping execution.',
    options
  );
  return [];
}
