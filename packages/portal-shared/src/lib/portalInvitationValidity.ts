/**
 * How long a client portal invitation stays usable, as whole days.
 *
 * The value lives in `tenant_settings.settings.clientPortal.invitationValidityDays`
 * (a JSON blob, so there is nothing to migrate) and every reader goes through
 * this resolver: an unset, malformed or out-of-range value answers with a
 * usable number rather than letting a tenant mail links that die in an hour or
 * never expire.
 */

/** A rollout runs over a working week, so a week is the floor an MSP can rely on. */
export const DEFAULT_PORTAL_INVITATION_VALIDITY_DAYS = 7;
export const MIN_PORTAL_INVITATION_VALIDITY_DAYS = 1;
export const MAX_PORTAL_INVITATION_VALIDITY_DAYS = 30;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

/**
 * Whole days inside the allowed range, or the default when the input is not a
 * number at all. A number outside the range is clamped rather than rejected:
 * the stored setting is a hint, and the nearest allowed validity is what the
 * admin meant.
 */
export function clampPortalInvitationValidityDays(value: unknown): number {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return DEFAULT_PORTAL_INVITATION_VALIDITY_DAYS;
  }

  return Math.min(
    MAX_PORTAL_INVITATION_VALIDITY_DAYS,
    Math.max(MIN_PORTAL_INVITATION_VALIDITY_DAYS, Math.round(numeric))
  );
}

/**
 * Resolve the tenant's invitation validity from its `tenant_settings.settings`
 * blob, which Postgres may hand back as an object or as a JSON string.
 */
export function resolvePortalInvitationValidityDays(settings: unknown): number {
  const parsed = typeof settings === 'string'
    ? (() => {
      try {
        return asRecord(JSON.parse(settings));
      } catch {
        return {};
      }
    })()
    : asRecord(settings);

  const clientPortal = asRecord(parsed.clientPortal);
  const configured = clientPortal.invitationValidityDays;

  if (configured === undefined || configured === null) {
    return DEFAULT_PORTAL_INVITATION_VALIDITY_DAYS;
  }

  return clampPortalInvitationValidityDays(configured);
}
