/**
 * Base layer: the three plain PSA tenants every guide starts from.
 *
 *   Oz       the sponsoring MSP (cm.msp.admin@oz.test, cm.msp.tech@oz.test)
 *   Kansas   control tenant: plain PSA, release flag off, "unaffected tenant"
 *   Emerald  flag-on non-participant: PSA, release flag on, nothing else
 *
 * The release flag (`release-v2-0-feature`, the 'co-managed' capability gate) is
 * evaluated per tenant by the feature-flag service, not stored in the database,
 * so this module cannot set it; `FLAG_EXPECTATIONS` records what the review
 * environment must configure and the runner prints it.
 *
 * Tenants are created the way the product does: the onboarding seed engine for
 * roles and permissions. Currency is whatever the tenant is configured for.
 */
import type { Knex } from 'knex';
import {
  CREATED, configuredDefaultCurrency, deterministicPassword, ensure, id, put, SILENT,
  type FixtureEngines, type FixtureModule, type VerifyReport,
} from './shared';

export const OZ = id('tenant/oz');
export const KANSAS = id('tenant/kansas');
export const EMERALD = id('tenant/emerald');
export const BASE_TENANTS = [OZ, KANSAS, EMERALD] as const;

export const FLAG_EXPECTATIONS: Record<string, 'on' | 'off'> = { Oz: 'on', Kansas: 'off', Emerald: 'on' };

interface TenantSpec { tenant: string; slug: string; name: string; adminEmail: string; domain: string }

const TENANT_SPECS: TenantSpec[] = [
  { tenant: OZ, slug: 'oz', name: 'Oz', adminEmail: 'cm.msp.admin@oz.test', domain: 'oz.test' },
  { tenant: KANSAS, slug: 'kansas', name: 'Kansas', adminEmail: 'cm.kansas.admin@kansas.test', domain: 'kansas.test' },
  { tenant: EMERALD, slug: 'emerald', name: 'Emerald City IT', adminEmail: 'cm.emerald.admin@emerald.test', domain: 'emerald.test' },
];

export interface FixtureUser {
  slug: string;
  tenant: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  roleName: string;
  password: string;
}

export const USERS: FixtureUser[] = [
  { slug: 'user/oz/admin', tenant: OZ, userId: id('user/oz/admin'), email: 'cm.msp.admin@oz.test',
    firstName: 'Cassia', lastName: 'Marsh', roleName: 'Admin', password: 'FixtureMspAdmin!2026' },
  { slug: 'user/oz/tech', tenant: OZ, userId: id('user/oz/tech'), email: 'cm.msp.tech@oz.test',
    firstName: 'Piet', lastName: 'Okonkwo', roleName: 'Technician', password: 'FixtureMspTech!2026' },
  { slug: 'user/kansas/admin', tenant: KANSAS, userId: id('user/kansas/admin'), email: 'cm.kansas.admin@kansas.test',
    firstName: 'Dorothy', lastName: 'Gale', roleName: 'Admin', password: 'FixtureKansasAdmin!2026' },
  { slug: 'user/emerald/admin', tenant: EMERALD, userId: id('user/emerald/admin'), email: 'cm.emerald.admin@emerald.test',
    firstName: 'Ozma', lastName: 'Verdi', roleName: 'Admin', password: 'FixtureEmeraldAdmin!2026' },
];

async function psaTenant(trx: Knex.Transaction, spec: TenantSpec, engines: FixtureEngines): Promise<void> {
  const fresh = !(await trx('tenants').where({ tenant: spec.tenant }).first());
  await put(trx, 'tenants', ['tenant'], {
    tenant: spec.tenant, client_name: spec.name, email: spec.adminEmail,
    plan: 'pro', product_code: 'psa', created_at: CREATED, updated_at: CREATED,
  });
  // MspLayoutClient forces /msp/onboarding while neither flag is set, which would
  // make every screen of a fixture tenant unreachable.
  await put(trx, 'tenant_settings', ['tenant'], {
    tenant: spec.tenant, onboarding_completed: true, onboarding_completed_at: CREATED, onboarding_skipped: false,
    settings: JSON.stringify({ timezone: 'UTC' }), created_at: CREATED, updated_at: CREATED,
  });
  if (fresh) await engines.runOnboardingSeeds(spec.tenant, 'psa', { transaction: trx, log: SILENT });
  const clientId = id(`client/${spec.slug}/self`);
  const currency = await configuredDefaultCurrency(trx, spec.tenant);
  await put(trx, 'clients', ['tenant', 'client_id'], {
    tenant: spec.tenant, client_id: clientId, client_name: spec.name, client_type: 'company',
    is_inactive: false, is_tax_exempt: false, billing_cycle: 'monthly',
    ...(currency ? { default_currency_code: currency } : {}),
    lifecycle_status: 'active', created_at: CREATED, updated_at: CREATED,
  });
  await put(trx, 'tenant_companies', ['tenant', 'client_id'], {
    tenant: spec.tenant, client_id: clientId, is_default: true, created_at: CREATED, updated_at: CREATED,
  });
  await ensure(trx, 'tenant_email_settings', { tenant: spec.tenant },
    { email_provider: 'resend', fallback_enabled: true, tracking_enabled: false, created_at: CREATED, updated_at: CREATED });
}

async function fixtureUsers(trx: Knex.Transaction, secret: string): Promise<void> {
  for (const user of USERS) {
    const role = await trx('roles')
      .where({ tenant: user.tenant, role_name: user.roleName, msp: true, client: false }).first();
    if (!role) throw new Error(`Role ${user.roleName} is missing in tenant ${user.tenant}`);
    await put(trx, 'users', ['tenant', 'user_id'], {
      tenant: user.tenant, user_id: user.userId, username: user.email, email: user.email,
      first_name: user.firstName, last_name: user.lastName,
      hashed_password: deterministicPassword(user.slug, user.password, secret),
      user_type: 'internal', auth_method: 'password', is_inactive: false, two_factor_enabled: false,
      is_google_user: false, created_at: CREATED, updated_at: CREATED,
    });
    await put(trx, 'user_roles', ['tenant', 'user_id', 'role_id'], {
      tenant: user.tenant, user_id: user.userId, role_id: role.role_id, created_at: CREATED,
    });
  }
}

export const baseModule: FixtureModule = {
  name: 'base',
  requires: [],
  async apply(trx, engines) {
    // Prove the deterministic hashes are the ones the application will accept.
    for (const user of USERS) {
      const stored = deterministicPassword(user.slug, user.password, engines.secret);
      if (!(await engines.verifyPassword(user.password, stored))) {
        throw new Error(`Fixture password for ${user.email} is not accepted by the application verifier`);
      }
    }
    for (const spec of TENANT_SPECS) await psaTenant(trx, spec, engines);
    await fixtureUsers(trx, engines.secret);
  },
  async verify(db) {
    const reports: VerifyReport[] = [];
    for (const spec of TENANT_SPECS) {
      const row = await db('tenants').where({ tenant: spec.tenant }).first('product_code');
      reports.push({ ok: row?.product_code === 'psa', area: 'base',
        detail: `${spec.name} is a plain psa tenant (${row?.product_code ?? 'missing'}); release flag must be ${FLAG_EXPECTATIONS[spec.name === 'Emerald City IT' ? 'Emerald' : spec.name]}` });
    }
    return reports;
  },
  async reset() {
    // The base tenants are shared review data other layers and guides build on;
    // removing a whole tenant is the tenant-deletion workflow's job, not a fixture's.
  },
};
