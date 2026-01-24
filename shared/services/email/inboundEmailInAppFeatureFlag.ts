const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

function parseCsv(value?: string): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  );
}

export function isInboundEmailInAppProcessingEnabled(params: {
  tenantId: string;
  providerId: string;
}): boolean {
  const globallyEnabled =
    typeof process.env.INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED === 'string' &&
    TRUE_VALUES.has(process.env.INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED.toLowerCase());

  const enabledTenants = parseCsv(process.env.INBOUND_EMAIL_IN_APP_TENANT_IDS);
  const enabledProviders = parseCsv(process.env.INBOUND_EMAIL_IN_APP_PROVIDER_IDS);

  return (
    globallyEnabled ||
    enabledTenants.has(params.tenantId) ||
    enabledProviders.has(params.providerId)
  );
}

