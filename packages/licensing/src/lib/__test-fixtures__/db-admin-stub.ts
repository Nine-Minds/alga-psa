// Stub for @alga-psa/db/admin in unit tests.
// Tests that exercise pure functions (verifyLicense, resolveSelfHostTier) do not
// call the DB; this stub prevents module resolution errors.
export async function getAdminConnection(): Promise<never> {
  throw new Error('getAdminConnection should not be called in unit tests');
}
