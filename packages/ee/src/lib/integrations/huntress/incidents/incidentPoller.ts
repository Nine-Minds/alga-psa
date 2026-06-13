/**
 * Community Edition stub. The Huntress incident poller is Enterprise-only;
 * without it the huntress-incident-poll job handler no-ops (Huntress
 * integrations cannot be configured in CE anyway).
 */

export const runHuntressIncidentPoll:
  | ((args: { tenantId: string; integrationId: string; trigger: string }) => Promise<unknown>)
  | undefined = undefined;
