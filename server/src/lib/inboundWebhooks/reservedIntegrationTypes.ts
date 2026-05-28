export const RESERVED_INBOUND_WEBHOOK_INTEGRATION_TYPES = [
  'ninjaone',
  'tacticalrmm',
  'tactical_rmm',
  'tanium',
  'xero',
  'xero_csv',
  'qbo',
  'quickbooks_online',
  'quickbooks_desktop',
  'quickbooks_csv',
  'entra',
  'entra_id',
  'microsoft_graph',
  'microsoft',
  'google',
] as const;

const RESERVED_INTEGRATION_TYPE_SET = new Set<string>(RESERVED_INBOUND_WEBHOOK_INTEGRATION_TYPES);

export function normalizeInboundWebhookIntegrationType(value: string): string {
  return value.trim().toLowerCase();
}

export function isReservedInboundWebhookIntegrationType(value: string): boolean {
  return RESERVED_INTEGRATION_TYPE_SET.has(normalizeInboundWebhookIntegrationType(value));
}

export function assertInboundWebhookSlugIsNotReserved(slug: string): void {
  if (isReservedInboundWebhookIntegrationType(slug)) {
    throw new Error(`Inbound webhook slug "${slug}" is reserved for a bundled integration`);
  }
}
