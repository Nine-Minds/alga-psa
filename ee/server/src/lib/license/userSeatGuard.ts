import { getAdminConnection } from '@alga-psa/db/admin';
import { getEffectiveSelfHostLicenseInput, resolveSelfHostTier, verifyLicense, type SelfHostLicenseInput } from '@alga-psa/licensing';

/**
 * Self-host license seat enforcement (Enterprise Edition).
 *
 * Returns the licensed seat count when adding another internal user would exceed
 * the governing license's signed `seats` claim; returns null when allowed:
 *   - SaaS / no `license_state` row,
 *   - 'essentials' floor tier (unmetered),
 *   - no/invalid license token,
 *   - or any read error (never block user creation on a transient fault).
 *
 * With a tenant, the governing license is the one tier resolution uses
 * (`getEffectiveSelfHostLicenseInput`): a tenant's own staged claim, when claims
 * are enabled, else the installation license. Without one, it is the installation
 * license, exactly as before.
 *
 * @param usedSeats current count of active internal users for the tenant
 * @param tenant the tenant the user is being added to
 */
export async function checkApplianceLicenseSeatLimit(
  usedSeats: number,
  tenant?: string,
): Promise<{ seats: number } | null> {
  try {
    let licenseRow: SelfHostLicenseInput | null;
    if (tenant) {
      licenseRow = await getEffectiveSelfHostLicenseInput(tenant);
    } else {
      // license_state is install-wide admin metadata; keep it on the admin
      // connection rather than tenantDb.
      licenseRow = await (await getAdminConnection())('license_state').orderBy('id').first() ?? null;
    }
    if (!licenseRow) return null;

    // Only a tenant-scoped claim is bound to the tenant here; the installation
    // license keeps its existing (unbound) seat check.
    const resolved = resolveSelfHostTier(licenseRow, licenseRow.license_scope === 'tenant' ? tenant : undefined);
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
