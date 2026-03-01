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

export function isImapInboundEmailInAppProcessingEnabled(params: {
  tenantId: string;
  providerId: string;
}): boolean {
  const imapGloballyEnabled =
    typeof process.env.IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED === 'string' &&
    TRUE_VALUES.has(process.env.IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED.toLowerCase());
  const enabledImapTenants = parseCsv(process.env.IMAP_INBOUND_EMAIL_IN_APP_TENANT_IDS);
  const enabledImapProviders = parseCsv(process.env.IMAP_INBOUND_EMAIL_IN_APP_PROVIDER_IDS);

  return (
    isInboundEmailInAppProcessingEnabled(params) ||
    imapGloballyEnabled ||
    enabledImapTenants.has(params.tenantId) ||
    enabledImapProviders.has(params.providerId)
  );
}

export function isImapInboundEmailInAppAsyncModeEnabled(params?: {
  tenantId: string;
  providerId: string;
}): boolean {
  const asyncDisabled =
    typeof process.env.IMAP_INBOUND_EMAIL_IN_APP_ASYNC_DISABLED === 'string' &&
    TRUE_VALUES.has(process.env.IMAP_INBOUND_EMAIL_IN_APP_ASYNC_DISABLED.toLowerCase());

  if (asyncDisabled) {
    return false;
  }

  if (
    params &&
    isUnifiedInboundEmailPointerQueueEnabled({
      tenantId: params.tenantId,
      providerId: params.providerId,
    })
  ) {
    return false;
  }

  return (
    typeof process.env.IMAP_INBOUND_EMAIL_IN_APP_ASYNC_ENABLED === 'string' &&
    TRUE_VALUES.has(process.env.IMAP_INBOUND_EMAIL_IN_APP_ASYNC_ENABLED.toLowerCase())
  );
}

export function isImapInboundEmailInAppEventBusFallbackEnabled(): boolean {
  return (
    typeof process.env.IMAP_INBOUND_EMAIL_IN_APP_EVENT_BUS_FALLBACK_ENABLED === 'string' &&
    TRUE_VALUES.has(process.env.IMAP_INBOUND_EMAIL_IN_APP_EVENT_BUS_FALLBACK_ENABLED.toLowerCase())
  );
}

export function isUnifiedInboundEmailPointerQueueEnabled(params: {
  tenantId: string;
  providerId: string;
}): boolean {
  const globallyEnabled =
    typeof process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED === 'string' &&
    TRUE_VALUES.has(process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED.toLowerCase());
  const enabledTenants = parseCsv(process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_TENANT_IDS);
  const enabledProviders = parseCsv(process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_PROVIDER_IDS);

  return (
    globallyEnabled ||
    enabledTenants.has(params.tenantId) ||
    enabledProviders.has(params.providerId)
  );
}
