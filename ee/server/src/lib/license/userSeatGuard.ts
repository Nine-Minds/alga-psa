import { getAdminConnection } from '@alga-psa/db/admin';
import { resolveSelfHostTier, verifyLicense } from '@alga-psa/licensing';

/**
 * Self-host appliance license seat enforcement (Enterprise Edition).
 *
 * Returns the licensed seat count when adding another internal user would exceed
 * the appliance license's signed `seats` claim; returns null when allowed:
 *   - SaaS / no `license_state` row,
 *   - 'essentials' floor tier (unmetered),
 *   - no/invalid license token,
 *   - or any read error (never block user creation on a transient fault).
 *
 * @param usedSeats current count of active internal users for the tenant
 */
export async function checkApplianceLicenseSeatLimit(
  usedSeats: number
): Promise<{ seats: number } | null> {
  try {
    const adminKnex = await getAdminConnection();
    const licenseRow = await adminKnex('license_state').orderBy('id').first();
    if (!licenseRow) return null;

    const resolved = resolveSelfHostTier(licenseRow);
    if (!resolved || resolved.tier === 'essentials' || !licenseRow.license_token) {
      return null;
    }

    const verified = verifyLicense(licenseRow.license_token);
    if (verified.valid && typeof verified.claims.seats === 'number' && usedSeats >= verified.claims.seats) {
      return { seats: verified.claims.seats };
    }
  } catch {
    // Don't block user creation on a transient license_state read failure.
  }
  return null;
}
