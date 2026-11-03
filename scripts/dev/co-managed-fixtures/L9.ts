/**
 * L9 layer: customer-owned integrations (email, identity).
 *
 * The customer workspace enters its own Google / Microsoft application in the
 * shared provider workbench, so there is no database state to seed: credentials
 * are entered live and belong to whichever tenant enters them. What this slice
 * pins is the OIDC emulator registration a review needs (the msgraph emulator's
 * signed Entra OIDC, `aud` = the tenant's client id) and the guarantee that
 * the layer itself creates no tenant and writes nothing.
 *
 * Seed the emulator client with:
 *   POST <control>/control/msgraph/seed/client  { clientId, clientSecret }
 * and start the app with MICROSOFT_SSO_EMULATOR_MODE=true MICROSOFT_LOGIN_BASE_URL=<emulator>.
 */
import { strayCoManagedTenants } from './L1a';
import type { FixtureModule, VerifyReport } from './shared';

export const L9_OIDC_CLIENT = {
  clientId: 'co-managed-customer-oidc',
  clientSecret: 'fixture-only-secret',
} as const;

export const l9Module: FixtureModule = {
  name: 'L9',
  // Module names are case-sensitive; L1a registers itself as 'L1a'.
  requires: ['L1a'],
  async apply() {
    // Nothing to write: provider credentials are entered live (review step 2).
  },
  async verify(db) {
    const reports: VerifyReport[] = [];
    const stray = await strayCoManagedTenants(db);
    reports.push({ ok: stray.length === 0, area: 'L9', detail: `L9 creates no co_managed tenant (found ${stray.length})` });
    return reports;
  },
  async reset() {
    // Nothing was created.
  },
};
