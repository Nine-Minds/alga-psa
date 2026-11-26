import {
  DEFAULT_PORTAL_INVITATION_VALIDITY_DAYS,
  resolvePortalInvitationValidityDays,
} from '@alga-psa/portal-shared/lib/portalInvitationValidity';

export interface ClientPortalFeatureSettings {
  appointmentsEnabled: boolean;
  /** Whole days a client portal invitation stays usable. */
  invitationValidityDays: number;
}

export const DEFAULT_CLIENT_PORTAL_FEATURE_SETTINGS: ClientPortalFeatureSettings = {
  appointmentsEnabled: true,
  invitationValidityDays: DEFAULT_PORTAL_INVITATION_VALIDITY_DAYS,
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
    // One resolver owns the validity, so the send path and this card cannot
    // disagree about how long a tenant's invitations last.
    invitationValidityDays: resolvePortalInvitationValidityDays(settings),
  };
}
