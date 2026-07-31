export interface ClientPortalFeatureSettings {
  appointmentsEnabled: boolean;
}

export const DEFAULT_CLIENT_PORTAL_FEATURE_SETTINGS: ClientPortalFeatureSettings = {
  appointmentsEnabled: true,
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function normalizeTenantSettings(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }

  return asRecord(value);
}

export function resolveClientPortalFeatureSettings(value: unknown): ClientPortalFeatureSettings {
  const settings = normalizeTenantSettings(value);
  const clientPortal = asRecord(settings.clientPortal);

  return {
    appointmentsEnabled:
      clientPortal.appointmentsEnabled !== false,
  };
}
