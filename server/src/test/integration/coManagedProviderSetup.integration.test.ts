/**
 * CM L9 (alga-2026-0002876): a co_managed customer workspace Admin configures its OWN
 * Microsoft and Google providers through the real actions.
 *
 * The workspace is provisioned through the real onboarding seeds (roles ->
 * permissions -> role grants), never by inserting role_permissions by hand, so
 * this fails if the catalog stops granting `system_settings` to the co_managed Admin.
 * The PSA sponsor is seeded the same way and must be byte-identical afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';

const ctx = vi.hoisted(() => ({
  user: null as any,
  secrets: new Map<string, string>(),
  db: null as any,
  asUser: (action: (...a: any[]) => any) => async (...args: any[]) => {
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(ctx.user.tenant, async () => action(ctx.user, { tenant: ctx.user.tenant }, ...args));
  },
}));

// Only the session lookup is replaced; permission checks stay the real RBAC against the seeded DB.
vi.mock('@alga-psa/auth/withAuth', async (importOriginal) => ({ ...(await importOriginal<any>()), withAuth: (a: any) => ctx.asUser(a) }));
vi.mock('@alga-psa/auth', async (importOriginal) => ({ ...(await importOriginal<any>()), withAuth: (a: any) => ctx.asUser(a) }));
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, createTenantKnex: async () => ({ knex: ctx.db, tenant: ctx.user?.tenant }) };
});
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async () => undefined,
    getTenantSecret: async (t: string, n: string) => ctx.secrets.get(`${t}:${n}`),
    setTenantSecret: async (t: string, n: string, v: string) => { ctx.secrets.set(`${t}:${n}`, v); },
    deleteTenantSecret: async (t: string, n: string) => { ctx.secrets.delete(`${t}:${n}`); },
  }),
  getSecret: async (_n: string, e?: string, f = '') => (e ? process.env[e] : undefined) ?? f,
}));

import {
  createMicrosoftProfile,
  listMicrosoftProfiles,
  setMicrosoftConsumerBinding,
} from '@alga-psa/integrations/actions/integrations/microsoftActions';
import {
  getGoogleIntegrationStatus,
  saveGoogleIntegrationSettings,
} from '@alga-psa/integrations/actions/integrations/googleActions';

const require = createRequire(import.meta.url);
const seedsRoot = '../../../../ee/server/seeds/onboarding';
const run = async (product: string, file: string, knex: Knex, tenant: string) =>
  require(`${seedsRoot}/${product}/${file}`).seed(knex, tenant);

const GOOGLE_CLIENT_ID = '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
const SERVICE_ACCOUNT = JSON.stringify({ client_email: 'sa@proj.iam.gserviceaccount.com', private_key: 'KEY' });

let db: Knex;

async function provision(product: 'psa' | 'co_managed', roles: string[]) {
  const tenant = uuidv4();
  await db('tenants').insert({
    tenant, client_name: `${product} ${tenant.slice(0, 6)}`, email: `${tenant.slice(0, 6)}@example.com`,
    product_code: product, billing_source: 'internal',
  });
  const seeds = ['01_roles.cjs', '02_permissions.cjs', '03_role_permissions.cjs'];
  for (const s of seeds) await run(product, s, db, tenant);
  const users: Record<string, any> = {};
  for (const roleName of roles) {
    const user_id = uuidv4();
    await db('users').insert({
      tenant, user_id, username: `${roleName}-${user_id.slice(0, 6)}`.toLowerCase(),
      email: `${user_id.slice(0, 6)}@example.com`, hashed_password: 'x', user_type: 'internal',
    });
    const role = await db('roles').where({ tenant, role_name: roleName, msp: true, client: false }).first();
    await db('user_roles').insert({ tenant, user_id, role_id: role.role_id });
    users[roleName] = { user_id, tenant, user_type: 'internal', roles: [] };
  }
  return { tenant, users };
}

const grants = async (tenant: string) =>
  (await db('role_permissions as rp')
    .join('permissions as p', function () { this.on('p.tenant', 'rp.tenant').andOn('p.permission_id', 'rp.permission_id'); })
    .join('roles as r', function () { this.on('r.tenant', 'rp.tenant').andOn('r.role_id', 'rp.role_id'); })
    .where('rp.tenant', tenant).andWhere('p.resource', 'system_settings')
    .select('r.role_name', 'p.action').orderBy(['r.role_name', 'p.action']))
    .map(r => `${r.role_name}:${r.action}`);

const sponsorState = async (tenant: string) => ({
  profiles: await db('microsoft_profiles').where({ tenant }).orderBy('profile_id'),
  bindings: await db('microsoft_profile_consumer_bindings').where({ tenant }).orderBy('consumer_type'),
  secrets: [...ctx.secrets.entries()].filter(([k]) => k.startsWith(`${tenant}:`)).sort(),
});

describe('co_managed customer provider setup (L9)', () => {
  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    ctx.db = db;
  }, 180_000);
  afterAll(async () => { await db?.destroy().catch(() => undefined); });

  it('lets the customer Admin save Microsoft and Google providers without touching the sponsor', async () => {
    const sponsor = await provision('psa', ['Admin']);
    ctx.user = sponsor.users.Admin;
    const sponsorCreate = await createMicrosoftProfile({
      displayName: 'Sponsor app', clientId: '22222222-2222-2222-2222-222222222222',
      clientSecret: 'sponsor-secret', tenantId: 'sponsor-directory',
    });
    expect(sponsorCreate.success).toBe(true);
    expect((await saveGoogleIntegrationSettings({
      projectId: 'sponsor-proj', gmailClientId: GOOGLE_CLIENT_ID, gmailClientSecret: 'sponsor-google',
      serviceAccountKeyJson: SERVICE_ACCOUNT, useSameOAuthAppForCalendar: true,
    })).success).toBe(true);
    const sponsorGrantsBefore = await grants(sponsor.tenant);
    const before = JSON.stringify(await sponsorState(sponsor.tenant));

    const customer = await provision('co_managed', ['Admin', 'Technician']);
    ctx.user = customer.users.Admin;

    const created = await createMicrosoftProfile({
      displayName: 'Customer app', clientId: '33333333-3333-3333-3333-333333333333',
      clientSecret: 'customer-ms-secret', tenantId: 'customer-directory',
    });
    expect(created.error).toBeUndefined();
    expect(created.success).toBe(true);
    const profileId = created.profile!.profileId;

    const bound = await setMicrosoftConsumerBinding({ consumerType: 'email', profileId });
    expect(bound.error).toBeUndefined();
    expect(bound.success).toBe(true);

    const google = await saveGoogleIntegrationSettings({
      projectId: 'customer-proj', gmailClientId: GOOGLE_CLIENT_ID, gmailClientSecret: 'customer-google-secret',
      serviceAccountKeyJson: SERVICE_ACCOUNT, useSameOAuthAppForCalendar: true,
    });
    expect(google.error).toBeUndefined();
    expect(google.success).toBe(true);

    // Stored under the customer's own tenant...
    expect(await db('microsoft_profiles').where({ tenant: customer.tenant }).count({ n: '*' }).first())
      .toMatchObject({ n: '1' });
    const customerSecrets = [...ctx.secrets.keys()].filter(k => k.startsWith(`${customer.tenant}:`));
    expect(customerSecrets.length).toBeGreaterThanOrEqual(2);
    expect([...ctx.secrets.values()].filter((v, i) => [...ctx.secrets.keys()][i].startsWith(customer.tenant))
      .some(v => v === 'customer-google-secret')).toBe(true);

    // ...and read back redacted.
    const listed = await listMicrosoftProfiles();
    expect(JSON.stringify(listed)).not.toContain('customer-ms-secret');
    const status = await getGoogleIntegrationStatus();
    expect(status.success).toBe(true);
    expect(JSON.stringify(status)).not.toContain('customer-google-secret');

    // The sponsor is byte-identical.
    expect(JSON.stringify(await sponsorState(sponsor.tenant))).toBe(before);
    expect(await grants(sponsor.tenant)).toEqual(sponsorGrantsBefore);
  }, 120_000);

  it('grants system_settings read/update to the co_managed Admin only, and leaves a plain PSA tenant unchanged', async () => {
    const customer = await provision('co_managed', ['Admin', 'Technician']);
    expect(await grants(customer.tenant)).toEqual(['Admin:read', 'Admin:update']);
    const psa = await provision('psa', ['Admin']);
    expect(await grants(psa.tenant)).toEqual(['Admin:create', 'Admin:delete', 'Admin:read', 'Admin:update']);
  }, 120_000);

  it('still answers Forbidden to a co_managed non-Admin role', async () => {
    const customer = await provision('co_managed', ['Admin', 'Technician']);
    ctx.user = customer.users.Technician;
    const ms = await createMicrosoftProfile({
      displayName: 'Nope', clientId: '44444444-4444-4444-4444-444444444444',
      clientSecret: 's', tenantId: 'd',
    });
    expect(ms).toMatchObject({ success: false, error: 'Forbidden' });
    const g = await saveGoogleIntegrationSettings({
      projectId: 'p', gmailClientId: GOOGLE_CLIENT_ID, gmailClientSecret: 's',
      serviceAccountKeyJson: SERVICE_ACCOUNT, useSameOAuthAppForCalendar: true,
    });
    expect(g).toMatchObject({ success: false, error: 'Forbidden' });
    expect(await db('microsoft_profiles').where({ tenant: customer.tenant }).count({ n: '*' }).first())
      .toMatchObject({ n: '0' });
  }, 120_000);
});
