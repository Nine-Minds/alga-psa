import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import knexFactory from 'knex';
import { hashPassword, verifyPassword } from '@alga-psa/core/encryption';

const require = createRequire(import.meta.url);
const { getDefaultRoles } = require('../server/migrations/utils/permissions/roleGrants.cjs');
const { reconcileAllTenants } = require('../server/migrations/utils/permissions/reconcileTenants.cjs');

const EXPECTED_DB = 'alga_stripe_tenant_test';
const EXPECTED_PORT = 55472;
const DEFAULT_RUN_ID = 'sec2926-hosted-ui-v1';
const ARTIFACT = resolve('docs/evidence/alga-2026-0002926-review-repair/hosted-ui-fixture.json');
const CASES = ['matching', 'mismatched', 'deleted'] as const;
type FixtureCase = typeof CASES[number];
type StripeResponse = { deleted?: boolean; metadata?: Record<string, string>; error?: { message?: string } };

type Fixture = {
  version: 1;
  database: { host: string; port: number; name: string; latestMigration: string };
  runId: string;
  adminPasswordEnv: 'STRIPE_UI_FIXTURE_PASSWORD';
  masterTenantId: string;
  productId: string;
  priceId: string;
  scenarios: Record<FixtureCase, {
    tenantId: string;
    userId: string;
    email: string;
    customerId: string;
    remoteMetadataTenantId: string;
    expectedRemoteDeleted: boolean;
  }>;
};

function assertEnvironment() {
  const host = process.env.DB_HOST || '';
  const port = Number(process.env.DB_PORT);
  if (process.env.DB_NAME_SERVER !== EXPECTED_DB || port !== EXPECTED_PORT || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing fixture writes: expected loopback PostgreSQL ${EXPECTED_DB} on port ${EXPECTED_PORT}.`);
  }
  if (!process.env.NEXTAUTH_SECRET) throw new Error('NEXTAUTH_SECRET is required to create a real credentials login.');
  if (!process.env.STRIPE_UI_FIXTURE_PASSWORD || process.env.STRIPE_UI_FIXTURE_PASSWORD.length < 12) {
    throw new Error('Set STRIPE_UI_FIXTURE_PASSWORD to a fixture-only password of at least 12 characters.');
  }
  if (process.env.STRIPE_API_BASE_URL !== 'http://127.0.0.1:4050' || process.env.STRIPE_SECRET_KEY !== 'sk_test_algasim') {
    throw new Error('Use the local Stripe simulator: STRIPE_API_BASE_URL=http://127.0.0.1:4050 and STRIPE_SECRET_KEY=sk_test_algasim.');
  }
  if (!process.env.DB_PASSWORD_SERVER || !process.env.DB_PASSWORD_ADMIN) {
    throw new Error('Both DB_PASSWORD_SERVER and DB_PASSWORD_ADMIN are required for the isolated database.');
  }
  return { host, port };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function uuidFor(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fixtureFor(runId: string, host: string): Fixture {
  if (!/^[a-z0-9-]{8,40}$/.test(runId)) throw new Error('Run id must be 8–40 lowercase letters, digits, or hyphens.');
  const slug = runId.replaceAll('-', '');
  const masterTenantId = uuidFor(`${runId}:master`);
  const matchingTenantId = uuidFor(`${runId}:matching`);
  const scenarios = Object.fromEntries(CASES.map((name) => {
    const tenantId = name === 'matching' ? matchingTenantId : uuidFor(`${runId}:${name}`);
    const remoteMetadataTenantId = name === 'mismatched' ? matchingTenantId : tenantId;
    return [name, {
      tenantId,
      userId: uuidFor(`${runId}:${name}:admin`),
      email: `stripe-owner-${name}-${slug}@example.invalid`,
      customerId: `cus_sec2926_${slug}_${name}`,
      remoteMetadataTenantId,
      expectedRemoteDeleted: name === 'deleted',
    }];
  })) as Fixture['scenarios'];
  return {
    version: 1,
    database: { host, port: EXPECTED_PORT, name: EXPECTED_DB, latestMigration: '20261103090000_validate_stripe_customer_binding_owner_fk.cjs' },
    runId,
    adminPasswordEnv: 'STRIPE_UI_FIXTURE_PASSWORD',
    masterTenantId,
    productId: `prod_sec2926_${slug}_pro`,
    priceId: `price_sec2926_${slug}_pro_monthly`,
    scenarios,
  };
}

async function controlSeed(name: string, payload: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:9500/control/stripe/seed/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  const body = await response.json() as { ok?: boolean; result?: unknown; error?: string };
  if (!response.ok || !body.ok) throw new Error(`Stripe simulator seeder ${name} failed: ${body.error ?? response.status}`);
  return body.result;
}

async function stripeRequest(method: 'GET' | 'POST' | 'DELETE', path: string, values?: Record<string, string>) {
  const body = new URLSearchParams(values);
  const response = await fetch(`${requiredEnv('STRIPE_API_BASE_URL')}${path}`, {
    method,
    headers: { authorization: `Bearer ${requiredEnv('STRIPE_SECRET_KEY')}`,
      ...(method === 'GET' ? {} : { 'content-type': 'application/x-www-form-urlencoded' }) },
    body: method === 'GET' ? undefined : body,
  });
  const payload = await response.json() as StripeResponse;
  if (!response.ok) throw new Error(`Stripe simulator ${method} ${path} failed: ${payload.error?.message ?? response.status}`);
  return payload;
}

function makeDb() {
  return knexFactory({ client: 'pg', connection: {
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME_SERVER,
    user: process.env.DB_USER_SERVER || 'postgres', password: requiredEnv('DB_PASSWORD_SERVER'),
  }, pool: { min: 0, max: 2 } });
}

async function checkMigrationState(db: ReturnType<typeof makeDb>) {
  const migration = await db('knex_migrations').where({ name: '20261103090000_validate_stripe_customer_binding_owner_fk.cjs' }).first();
  if (!migration) throw new Error('The isolated database has not applied the Stripe owner validation migration.');
  const constraint = await db.raw(`SELECT convalidated FROM pg_constraint
    WHERE conname='stripe_customers_binding_owner_fk' AND conrelid='stripe_customers'::regclass`);
  if (constraint.rows[0]?.convalidated !== true) throw new Error('The Stripe customer owner FK is missing or not validated.');
  const licenseTable = await db.schema.hasTable('license_state');
  if (!licenseTable) throw new Error('Expected migrated license_state table so hosted mode can be proven by row absence.');
  const licenseRows = await db('license_state').count('* as count').first();
  if (Number(licenseRows?.count) !== 0) throw new Error('Refusing to seed hosted fixture: isolated database has a license_state row.');
}

async function createScenarioRows(db: ReturnType<typeof makeDb>, fixture: Fixture) {
  const passwordHash = await hashPassword(requiredEnv('STRIPE_UI_FIXTURE_PASSWORD'));
  await db.transaction(async (trx) => {
    const allTenants = [
      { tenant: fixture.masterTenantId, client_name: `Stripe review billing master ${fixture.runId}`, email: `stripe-owner-master-${fixture.runId}@example.invalid` },
      ...CASES.map((name) => ({
        tenant: fixture.scenarios[name].tenantId,
        client_name: `Stripe review ${name} ${fixture.runId}`,
        email: fixture.scenarios[name].email,
      })),
    ];
    for (const tenant of allTenants) {
      const existing = await trx('tenants').where({ tenant: tenant.tenant }).first('client_name');
      if (existing && existing.client_name !== tenant.client_name) throw new Error(`Tenant UUID collision for ${tenant.tenant}; refusing to overwrite it.`);
      await trx('tenants').insert({ ...tenant, product_code: 'psa', plan: 'pro', created_at: trx.fn.now() })
        .onConflict('tenant').merge({ client_name: tenant.client_name, email: tenant.email, product_code: 'psa', plan: 'pro' });
    }
    for (const name of CASES) {
      const scenario = fixture.scenarios[name];
      const binding = await trx('stripe_customer_bindings').where({ stripe_customer_external_id: scenario.customerId }).first('tenant');
      const mapping = await trx('stripe_customers').where({ stripe_customer_external_id: scenario.customerId }).first('tenant');
      if ((binding && binding.tenant !== scenario.tenantId) || (mapping && mapping.tenant !== scenario.tenantId)) {
        throw new Error(`${name}: fixture customer id is already owned by another tenant; refusing to reassign it.`);
      }
    }
    for (const name of CASES) {
      const { tenantId, userId, email } = fixture.scenarios[name];
      await trx('tenant_settings').insert({ tenant: tenantId, onboarding_completed: true,
        onboarding_completed_at: trx.fn.now(), onboarding_skipped: false, settings: { timezone: 'UTC' } })
        .onConflict('tenant').merge({ onboarding_completed: true, onboarding_skipped: false });
      let adminRoleId = '';
      for (const role of getDefaultRoles('psa').filter((entry: { legacy?: boolean }) => !entry.legacy)) {
        const roleId = uuidFor(`${fixture.runId}:${name}:${role.key}`);
        await trx('roles').insert({ tenant: tenantId, role_id: roleId,
          role_name: role.roleName, msp: role.msp, client: role.client })
          .onConflict(['tenant', 'role_id']).merge({ role_name: role.roleName, msp: role.msp, client: role.client });
        if (role.key === 'msp:Admin') adminRoleId = roleId;
      }
      const reconciliation = await reconcileAllTenants(trx, {
        tenantId, product: 'psa', label: 'Stripe ownership hosted UI fixture', onDrift: 'throw',
        logger: { log() {}, warn() {}, error() {} },
      });
      if (reconciliation.failed.length || reconciliation.skipped.length) throw new Error(`Permission setup failed for ${name} fixture.`);
      await trx('users').insert({ tenant: tenantId, user_id: userId, username: email, email,
        hashed_password: passwordHash, first_name: 'Stripe Review', last_name: name,
        user_type: 'internal', auth_method: 'password', is_inactive: false,
        two_factor_enabled: false, is_google_user: false })
        .onConflict(['tenant', 'user_id']).merge({ username: email, email, hashed_password: passwordHash,
          user_type: 'internal', auth_method: 'password', is_inactive: false });
      await trx('user_roles').insert({ tenant: tenantId, user_id: userId, role_id: adminRoleId })
        .onConflict(['tenant', 'user_id', 'role_id']).ignore();
    }
    for (const name of CASES) {
      const scenario = fixture.scenarios[name];
      const stripeCustomerId = uuidFor(`${fixture.runId}:${name}:stripe-customer-row`);
      await trx('stripe_customer_bindings').insert({ stripe_customer_external_id: scenario.customerId, tenant: scenario.tenantId })
        .onConflict('stripe_customer_external_id').ignore();
      await trx('stripe_customers').insert({ tenant: scenario.tenantId, stripe_customer_id: stripeCustomerId,
        stripe_customer_external_id: scenario.customerId, billing_tenant: fixture.masterTenantId,
        email: scenario.email, name: `Stripe review ${name}` })
        .onConflict(['tenant', 'stripe_customer_external_id']).merge({ stripe_customer_id: stripeCustomerId,
          billing_tenant: fixture.masterTenantId, email: scenario.email, name: `Stripe review ${name}` });
    }
  });
}

async function prepare(fixture: Fixture) {
  const db = makeDb();
  try {
    await checkMigrationState(db);
    await controlSeed('config', { secretKey: 'sk_test_algasim', webhookSecret: 'whsec_algasim', publishableKey: 'pk_test_algasim' });
    await controlSeed('product', { id: fixture.productId, name: 'Alga PSA review Pro' });
    await controlSeed('price', { id: fixture.priceId, product: fixture.productId, unitAmount: 1000, currency: 'usd', interval: 'month' });
    for (const name of CASES) {
      const scenario = fixture.scenarios[name];
      await stripeRequest('POST', '/v1/customers', {
        id: scenario.customerId, email: scenario.email, name: `Stripe review ${name}`,
        'metadata[tenant_id]': scenario.remoteMetadataTenantId,
      });
    }
    await stripeRequest('DELETE', `/v1/customers/${fixture.scenarios.deleted.customerId}`);
    await createScenarioRows(db, fixture);
    await mkdir(dirname(ARTIFACT), { recursive: true });
    await writeFile(ARTIFACT, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  } finally {
    await db.destroy();
  }
}

async function verify(fixture: Fixture) {
  const db = makeDb();
  const { resolveTenantTier } = await import('@alga-psa/licensing');
  const { destroyAdminConnection } = await import('@alga-psa/db/admin');
  const password = requiredEnv('STRIPE_UI_FIXTURE_PASSWORD');
  try {
    await checkMigrationState(db);
    for (const name of CASES) {
      const scenario = fixture.scenarios[name];
      const tenant = await db('tenants').where({ tenant: scenario.tenantId }).first();
      if (!tenant || tenant.plan !== 'pro' || tenant.product_code !== 'psa') throw new Error(`${name}: hosted Pro tenant row is missing.`);
      const user = await db('users').where({ tenant: scenario.tenantId, user_id: scenario.userId }).first();
      if (!user || user.email !== scenario.email || user.user_type !== 'internal' || user.is_inactive ||
          !(await verifyPassword(password, user.hashed_password))) throw new Error(`${name}: credentials login is not ready.`);
      const accountPermission = await db('user_roles as ur')
        .join('roles as r', function () { this.on('r.tenant', 'ur.tenant').andOn('r.role_id', 'ur.role_id'); })
        .join('role_permissions as rp', function () { this.on('rp.tenant', 'r.tenant').andOn('rp.role_id', 'r.role_id'); })
        .join('permissions as p', function () { this.on('p.tenant', 'rp.tenant').andOn('p.permission_id', 'rp.permission_id'); })
        .where({ 'ur.tenant': scenario.tenantId, 'ur.user_id': scenario.userId,
          'r.role_name': 'Admin', 'r.msp': true, 'r.client': false,
          'p.resource': 'account_management', 'p.action': 'update', 'p.msp': true })
        .first('p.permission_id');
      if (!accountPermission) throw new Error(`${name}: admin has no account_management:update permission.`);
      const customer = await db('stripe_customers').where({ tenant: scenario.tenantId, stripe_customer_external_id: scenario.customerId }).first();
      const binding = await db('stripe_customer_bindings').where({ stripe_customer_external_id: scenario.customerId }).first();
      if (!customer || binding?.tenant !== scenario.tenantId) throw new Error(`${name}: customer mapping/binding does not match its tenant.`);
      if (await resolveTenantTier(scenario.tenantId) !== 'pro') throw new Error(`${name}: licensing resolver did not resolve hosted Pro.`);
      const remote = await stripeRequest('GET', `/v1/customers/${scenario.customerId}`);
      const deleted = remote.deleted === true;
      if (deleted !== scenario.expectedRemoteDeleted) throw new Error(`${name}: remote deleted state does not match the fixture.`);
      if (!deleted && remote.metadata?.tenant_id !== scenario.remoteMetadataTenantId) {
        throw new Error(`${name}: remote ownership metadata does not match the fixture.`);
      }
      console.log(`${name}: login, Admin billing permission, hosted Pro resolution, mapping/binding, remote state OK`);
    }
    console.log(`hosted licensing: no license_state row; resolveTenantTier reports pro for all scenarios in ${fixture.database.name}`);
  } finally {
    await db.destroy();
    await destroyAdminConnection();
  }
}

async function readFixture(path: string): Promise<Fixture> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as Fixture;
}

async function main() {
  const mode = process.argv[2];
  const { host } = assertEnvironment();
  if (mode === 'prepare') {
    const runId = process.env.STRIPE_UI_FIXTURE_RUN_ID || DEFAULT_RUN_ID;
    const fixture = fixtureFor(runId, host);
    await prepare(fixture);
    await verify(fixture);
    console.log(`fixture manifest: ${ARTIFACT}`);
    console.log(`Pro price environment: STRIPE_PRO_PRICE_ID=${fixture.priceId}`);
  } else if (mode === 'verify') {
    const fixture = await readFixture(process.argv[3] || ARTIFACT);
    await verify(fixture);
  } else {
    throw new Error('Usage: npx tsx scripts/prepare-stripe-ownership-hosted-ui-fixture.ts prepare|verify [fixture.json]');
  }
}

main().then(
  () => process.exit(0),
  (error) => { console.error(error); process.exit(1); },
);
