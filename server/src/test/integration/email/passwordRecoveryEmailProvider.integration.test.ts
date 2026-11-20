/**
 * Password recovery email-provider path: real action + real registry + real
 * DB + real SMTP into the in-process smtp-sink emulator.
 *
 * Regression matrix (plan 2026-08-14-password-recovery-email-provider-plan):
 *
 *  1. MSP recovery works with EMAIL_ENABLE='false' via an enabled tenant SMTP
 *     provider pointed at the emulator; public result is true and exactly one
 *     message is delivered.
 *  2. Client-portal recovery works with the global flag unset; the message
 *     carries the set-new-password link, portal=client, and the encoded
 *     portalDomain.
 *  3. The delivered links contain a JWT accepted by the deployed completion
 *     tokenizer (getInfoFromToken) with the normalized email + portal type.
 *  4. Each happy path creates exactly one tenant-scoped email_sending_logs row
 *     with status='sent' for the emulator-backed tenant SMTP provider.
 *  5. Enumeration guards: invalid/unknown/inactive/portal-mismatched requests
 *     all return the same true value with zero messages and zero log rows.
 *  6. Provider failure (reject-mail fault) still returns true publicly, sends
 *     nothing, writes a status='failed' row for the tenant SMTP provider, and
 *     emits a password_recovery_send_failed diagnostic without the token or
 *     reset URL.
 *  7. Canonical-origin guard: with no trusted origin configured
 *     (NEXT_PUBLIC_BASE_URL/NEXTAUTH_URL/HOST all absent) recovery returns the
 *     same true value and sends nothing, emitting a password_recovery_send_refused
 *     diagnostic pointing at the missing configuration. With NEXT_PUBLIC_BASE_URL
 *     absent but a trusted fallback (NEXTAUTH_URL) configured, the delivered
 *     link is an absolute URL on that origin and is logged as sent.
 *
 *  8. Tenant binding (alga-2026-0002632): one client email in two tenants, each
 *     with its own portal domain, in both insert orders. A hinted request sends
 *     exactly one email through the hinted tenant with a token naming that
 *     tenant's user; redemption changes only that user's password; an unhinted
 *     request fans out one email per tenant; MSP slug hints behave the same.
 *     Over the per-email rate limit nothing is sent.
 *
 * The only mocked seams are the application logger (to inspect diagnostics)
 * and the @alga-psa/auth barrel that setup.ts globally replaces; the action is
 * imported through the real @alga-psa/auth/actions source.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';

import { tenantDb, resetTenantConnectionPool } from '@alga-psa/db';
import { EmulatorHost } from '@alga-psa/emulator-host';
import smtpSink, { CapturedEmail } from '@alga-psa/emulator-smtp-sink';
import { getSystemEmailService, sendPasswordResetEmail, TenantEmailService } from '@alga-psa/email';
import { recoverPassword } from '@alga-psa/auth/actions';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';

import { getInfoFromToken } from '../../../../../packages/auth/src/lib/tokenizer';
import { setNewPassword, getAccountInfoFromToken } from '../../../../../packages/auth/src/actions/useRegister';
import { invalidateTenantAuthPolicyCache } from '../../../../../packages/auth/src/lib/authPolicyStore';
import { buildTenantPortalSlug } from '../../../../../packages/db/src/lib/tenantSlug';
import {
  registerAuthEmailProvider,
  resetAuthEmailRegistry,
} from '../../../../../packages/auth/src/lib/emailRegistry';

const loggerError = vi.fn();
const loggerWarn = vi.fn();
const loggerInfo = vi.fn();
const loggerDebug = vi.fn();
vi.mock('@alga-psa/core/logger', () => ({
  default: {
    error: (...args: unknown[]) => loggerError(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
    info: (...args: unknown[]) => loggerInfo(...args),
    debug: (...args: unknown[]) => loggerDebug(...args),
    system: (...args: unknown[]) => loggerInfo(...args),
  },
}));

// The per-email limit is a real in-memory budget (3 per 15 minutes) that this
// suite would exhaust by reusing addresses. It is controllable here; the limiter
// itself is covered by rateLimiting.test.ts.
const limitMock = vi.hoisted(() => vi.fn(async (_email: string) => ({ success: true as boolean })));
vi.mock('../../../../../packages/auth/src/lib/security/rateLimiting', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, checkPasswordResetLimit: (email: string) => limitMock(email) };
});

const SMTP_PROVIDER_ID = 'tenant-smtp-emulator';
const HOOK_TIMEOUT = 240_000;

function normalizeAddressList(row: any): string[] {
  const raw = row?.to_addresses;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  return [];
}

describe('password recovery email provider path (real DB + real SMTP)', () => {
  let db: Knex;
  let host: EmulatorHost;
  let controlUrl: string;
  let smtpPort: number;
  let tenantId: string;
  let internalEmail: string;
  let clientEmail: string;
  let inactiveInternalEmail: string;
  let unknownEmail: string;

  const envBackup: Record<string, string | undefined> = {
    EMAIL_ENABLE: undefined,
    SECRET_KEY: undefined,
    NEXT_PUBLIC_BASE_URL: undefined,
    NEXTAUTH_URL: undefined,
    HOST: undefined,
  };

  async function capturedEmails(): Promise<CapturedEmail[]> {
    const response = await fetch(`${controlUrl}/control/smtp-sink/state/emails`);
    const body = await response.json();
    return (body?.result ?? []) as CapturedEmail[];
  }

  async function controlPost(path: string, body: unknown): Promise<void> {
    const response = await fetch(`${controlUrl}/control/smtp-sink/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.ok, `control ${path}: ${response.status}`).toBe(true);
  }

  async function resetSharedState(): Promise<void> {
    await host.reset('smtp-sink');
    await db('email_sending_logs').where({ tenant: tenantId }).del();
    // A settings save elsewhere would have invalidated this; do it explicitly so
    // cases never share a cached provider.
    await TenantEmailService.invalidateTenantSettings(tenantId);
    // Restore the canonical-origin baseline before every case. Individual cases
    // override it to prove the guard and the trusted-fallback derivation.
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3614';
    delete process.env.NEXTAUTH_URL;
    delete process.env.HOST;
    limitMock.mockReset().mockResolvedValue({ success: true });
    loggerError.mockClear();
    loggerWarn.mockClear();
    loggerInfo.mockClear();
    loggerDebug.mockClear();
  }

  function resetLinkOf(email: CapturedEmail): string {
    const text = email.text || email.html || '';
    const match = text.match(/https?:\/\/[^\s<"']+/);
    if (!match) throw new Error('No absolute reset link found in delivered message');
    return match[0];
  }

  function expectUsableAbsoluteResetLink(email: CapturedEmail, expectedOrigin: string): string {
    const link = resetLinkOf(email);
    expect(link).not.toContain('undefined');
    const url = new URL(link);
    expect(['http:', 'https:']).toContain(url.protocol);
    expect(url.origin).toBe(expectedOrigin);
    expect(url.pathname).toBe('/auth/password-reset/set-new-password');
    return link;
  }

  function expectNoTokenOrUrlIn(payload: unknown): void {
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('token=');
    expect(serialized).not.toContain('/auth/password-reset/set-new-password');
  }

  beforeAll(async () => {
    if (!process.env.CI) {
      wireLocalTestDbEnv();
    }

    db = await createTestDbConnection();
    await resetTenantConnectionPool();

    host = new EmulatorHost({ emulators: [smtpSink], controlPort: 0, ports: { 'smtp-sink': 0 } });
    const { controlPort, ports } = await host.start();
    controlUrl = `http://127.0.0.1:${controlPort}`;
    smtpPort = ports['smtp-sink'];

    for (const key of Object.keys(envBackup)) {
      envBackup[key] = process.env[key];
    }
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3614';
    process.env.SECRET_KEY = 'password-recovery-integration-test-secret';
    delete process.env.EMAIL_ENABLE;

    // Wire the real email implementations exactly as initializeApp does.
    registerAuthEmailProvider({
      sendPasswordResetEmail,
      getSystemEmailService: async () => getSystemEmailService(),
      getTenantEmailService: async (tenant) => TenantEmailService.getInstance(tenant),
    });

    tenantId = await createTenant(db, 'Password Recovery Tenant');

    const defaultClientId = uuidv4();
    await tenantDb(db, tenantId).table('clients').insert({
      client_id: defaultClientId,
      tenant: tenantId,
      client_name: 'Password Recovery Tenant',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await tenantDb(db, tenantId).table('tenant_companies').insert({
      tenant: tenantId,
      client_id: defaultClientId,
      is_default: true,
    });

    const shortId = tenantId.substring(0, 8);
    internalEmail = `internal-${shortId}@example.com`;
    clientEmail = `client-${shortId}@example.com`;
    inactiveInternalEmail = `inactive-${shortId}@example.com`;
    unknownEmail = `unknown-${shortId}@example.com`;

    await createUser(db, tenantId, {
      email: internalEmail,
      username: 'internal-user',
      first_name: 'Internal',
      last_name: 'User',
      user_type: 'internal',
    });
    await createUser(db, tenantId, {
      email: clientEmail,
      username: 'client-user',
      first_name: 'Client',
      last_name: 'User',
      user_type: 'client',
    });
    await createUser(db, tenantId, {
      email: inactiveInternalEmail,
      username: 'inactive-internal-user',
      user_type: 'internal',
      is_inactive: true,
    });

    await tenantDb(db, tenantId).table('tenant_email_settings').insert({
      tenant: tenantId,
      default_from_domain: 'example.com',
      custom_domains: JSON.stringify([]),
      email_provider: 'smtp',
      provider_configs: JSON.stringify([
        {
          providerId: SMTP_PROVIDER_ID,
          providerType: 'smtp',
          isEnabled: true,
          config: {
            host: '127.0.0.1',
            port: smtpPort,
            secure: false,
            from: `password-reset@example.com`,
            rejectUnauthorized: false,
            requireTLS: false,
          },
        },
      ]),
      fallback_enabled: true,
      tracking_enabled: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await host?.stop().catch(() => undefined);
    await db?.destroy();
    await resetTenantConnectionPool();
    resetAuthEmailRegistry();
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await resetSharedState();
  });

  it('sends to an active MSP user when EMAIL_ENABLE=false and logs one sent row', async () => {
    process.env.EMAIL_ENABLE = 'false';

    const result = await recoverPassword(internalEmail, 'msp');
    expect(result).toBe(true);

    const emails = await capturedEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toContain(internalEmail);
    expect(emails[0].subject).toBe('Password Reset Request');
    expect(emails[0].text).toContain('/auth/password-reset/set-new-password');
    expect(emails[0].html).toContain('/auth/password-reset/set-new-password');
    expectUsableAbsoluteResetLink(emails[0], 'http://localhost:3614');

    const rows = await db('email_sending_logs').where({ tenant: tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].provider_id).toBe(SMTP_PROVIDER_ID);
    expect(rows[0].provider_type).toBe('smtp');
    expect(normalizeAddressList(rows[0])).toContain(internalEmail);
    expect(rows[0].subject).toBe('Password Reset Request');
  });

  it('sends to an active client user with the flag unset, carrying portal and portalDomain', async () => {
    delete process.env.EMAIL_ENABLE;

    const result = await recoverPassword(clientEmail, 'client', 'portal.example.test');
    expect(result).toBe(true);

    const emails = await capturedEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toContain(clientEmail);

    expect(emails[0].text).toContain('/auth/password-reset/set-new-password');
    expect(emails[0].text).toContain('portal=client');
    expect(emails[0].text).toContain('portalDomain=portal.example.test');
    expectUsableAbsoluteResetLink(emails[0], 'http://localhost:3614');

    const rows = await db('email_sending_logs').where({ tenant: tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].provider_id).toBe(SMTP_PROVIDER_ID);
    expect(rows[0].provider_type).toBe('smtp');
    expect(normalizeAddressList(rows[0])).toContain(clientEmail);
  });

  it('mints links whose JWT is accepted by the deployed tokenizer for both portal types', async () => {
    process.env.EMAIL_ENABLE = 'false';

    await recoverPassword(internalEmail, 'msp');
    await recoverPassword(clientEmail, 'client', 'portal.example.test');

    const emails = await capturedEmails();
    expect(emails).toHaveLength(2);

    const tokenOf = (email: CapturedEmail): string => {
      const match = (email.text || email.html || '').match(/token=([^&\s"]+)/);
      if (!match) throw new Error('No token parameter found in delivered message');
      return decodeURIComponent(match[1]);
    };

    const mspInfo = await getInfoFromToken(tokenOf(emails[0]));
    expect(mspInfo.errorType).toBeNull();
    expect(mspInfo.userInfo?.email).toBe(internalEmail);
    expect(mspInfo.userInfo?.user_type).toBe('internal');

    const clientInfo = await getInfoFromToken(tokenOf(emails[1]));
    expect(clientInfo.errorType).toBeNull();
    expect(clientInfo.userInfo?.email).toBe(clientEmail);
    expect(clientInfo.userInfo?.user_type).toBe('client');
  });

  it('refuses to send and returns the same success value when no trusted origin is configured', async () => {
    process.env.EMAIL_ENABLE = 'false';
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.HOST;

    const result = await recoverPassword(internalEmail, 'msp');
    expect(result).toBe(true);

    // Nothing was handed to the provider: no message, no send-log row, and no
    // token minted for delivery.
    expect(await capturedEmails()).toHaveLength(0);
    const rows = await db('email_sending_logs').where({ tenant: tenantId });
    expect(rows).toHaveLength(0);

    // The refusal is diagnosable from server logs with a pointer to the fix.
    const refusedCalls = loggerError.mock.calls.filter(
      (call) => call[0] === 'password_recovery_send_refused'
    );
    expect(refusedCalls.length).toBeGreaterThan(0);
    const payload = refusedCalls[refusedCalls.length - 1][1] as Record<string, unknown>;
    expect(payload.portal).toBe('msp');
    expect(payload.userType).toBe('internal');
    expect(payload.tenant).toBe(tenantId);
    expect(String(payload.error ?? '')).toContain('NEXT_PUBLIC_BASE_URL');
    expectNoTokenOrUrlIn(payload);
  });

  it('derives a usable reset link from NEXTAUTH_URL when NEXT_PUBLIC_BASE_URL is absent', async () => {
    process.env.EMAIL_ENABLE = 'false';
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.HOST;
    process.env.NEXTAUTH_URL = 'https://trusted.example.test';

    const result = await recoverPassword(internalEmail, 'msp');
    expect(result).toBe(true);

    const emails = await capturedEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toContain(internalEmail);
    // The derivation path must produce an absolute link on the trusted origin,
    // never one beginning with "undefined".
    const link = expectUsableAbsoluteResetLink(emails[0], 'https://trusted.example.test');
    expect(link).not.toContain('undefined');

    const rows = await db('email_sending_logs').where({ tenant: tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('sent');
    expect(rows[0].provider_id).toBe(SMTP_PROVIDER_ID);
    expect(rows[0].provider_type).toBe('smtp');
    expect(normalizeAddressList(rows[0])).toContain(internalEmail);
  });

  it('keeps the public result, mail, and log state identical for every non-match', async () => {
    process.env.EMAIL_ENABLE = 'false';

    const cases: Array<{ email: string; portal: 'msp' | 'client' }> = [
      { email: 'not-an-email', portal: 'msp' },
      { email: unknownEmail, portal: 'msp' },
      { email: inactiveInternalEmail, portal: 'msp' },
      { email: internalEmail, portal: 'client' },
      { email: clientEmail, portal: 'msp' },
    ];

    for (const { email, portal } of cases) {
      const result = await recoverPassword(email, portal);
      expect(result, `${email} via ${portal} must return true`).toBe(true);
    }

    expect(await capturedEmails()).toHaveLength(0);
    const rows = await db('email_sending_logs').where({ tenant: tenantId });
    expect(rows).toHaveLength(0);
  });

  it('returns true and records a failed tenant SMTP row, retaining the cause, when the provider rejects', async () => {
    process.env.EMAIL_ENABLE = 'false';

    await controlPost('faults/reject-mail/arm', { code: 552 });

    const result = await recoverPassword(internalEmail, 'msp');
    expect(result).toBe(true);

    // Nothing was delivered to the sink while the fault was armed.
    expect(await capturedEmails()).toHaveLength(0);

    // A provider-level attempt was made: the tenant SMTP provider logged a
    // failed row rather than being masked by the generic system-disabled path.
    const rows = await db('email_sending_logs').where({ tenant: tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].provider_id).toBe(SMTP_PROVIDER_ID);
    expect(rows[0].provider_type).toBe('smtp');
    expect(String(rows[0].error_message ?? '')).toBe(
      'SMTP send failed. Check the SMTP host, port, credentials, and TLS settings.'
    );
    expect(String(rows[0].error_message ?? '')).not.toContain('disabled or not configured');
    // The SMTP-level rejection reached the log: the provider records the
    // nodemailer command and error code for the data-phase rejection.
    expect(rows[0].metadata?.command).toBe('DATA');
    expect(rows[0].metadata?.errorCode).toBe('EMESSAGE');

    // The action emitted its stable diagnostic with the tenant cause retained
    // and never the token or reset URL.
    const failedCalls = loggerError.mock.calls.filter(
      (call) => call[0] === 'password_recovery_send_failed'
    );
    expect(failedCalls.length).toBeGreaterThan(0);
    const payload = failedCalls[failedCalls.length - 1][1] as Record<string, unknown>;
    expect(payload.portal).toBe('msp');
    expect(payload.userType).toBe('internal');
    expect(payload.tenant).toBe(tenantId);
    expect(String(payload.error ?? '')).toContain('SMTP');
    expectNoTokenOrUrlIn(payload);
  });

  describe('one email in two tenants (alga-2026-0002632)', () => {
    interface Org {
      tenant: string;
      userId: string;
      firstName: string;
      portalDomain: string;
      slug: string;
      password: string;
    }

    function tokenOf(email: CapturedEmail): string {
      const match = (email.text || email.html || '').match(/token=([^&\s"]+)/);
      if (!match) throw new Error('No token parameter found in delivered message');
      return decodeURIComponent(match[1]);
    }

    async function provisionTenant(name: string, from: string): Promise<string> {
      const tenant = await createTenant(db, name);
      const clientId = uuidv4();
      await tenantDb(db, tenant).table('clients').insert({
        client_id: clientId,
        tenant,
        client_name: name,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      await tenantDb(db, tenant).table('tenant_companies').insert({ tenant, client_id: clientId, is_default: true });
      await tenantDb(db, tenant).table('tenant_email_settings').insert({
        tenant,
        default_from_domain: 'example.com',
        custom_domains: JSON.stringify([]),
        email_provider: 'smtp',
        provider_configs: JSON.stringify([
          {
            providerId: SMTP_PROVIDER_ID,
            providerType: 'smtp',
            isEnabled: true,
            config: { host: '127.0.0.1', port: smtpPort, secure: false, from, rejectUnauthorized: false, requireTLS: false },
          },
        ]),
        fallback_enabled: true,
        tracking_enabled: false,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      return tenant;
    }

    async function addPortalDomain(tenant: string, domain: string): Promise<void> {
      await db('portal_domains').insert({
        tenant,
        domain,
        canonical_host: `canonical-${domain}`,
        status: 'active',
      });
    }

    async function hashOf(org: Org): Promise<string> {
      const row = await tenantDb(db, org.tenant).table('users').where({ user_id: org.userId }).first();
      return row.hashed_password;
    }

    async function sentTenants(): Promise<string[]> {
      const rows = await db('email_sending_logs').whereIn('tenant', [orgA.tenant, orgB.tenant]).where({ status: 'sent' });
      return rows.map((r: { tenant: string }) => r.tenant);
    }

    let orgA: Org;
    let orgB: Org;
    let sharedEmail: string;
    let sharedInternalEmail: string;

    /**
     * Two tenants holding the same client and internal email. `first` is the tenant
     * whose users are inserted first: heap order alone must not decide the outcome.
     */
    async function buildFixture(first: 'A' | 'B'): Promise<void> {
      const suffix = uuidv4().slice(0, 8);
      sharedEmail = `dual-${suffix}@example.com`;
      sharedInternalEmail = `dual-internal-${suffix}@example.com`;
      const make = async (label: 'A' | 'B'): Promise<Org> => {
        const tenant = await provisionTenant(`Reset Tenant ${label} ${suffix}`, `reset-${label.toLowerCase()}-${suffix}@example.com`);
        const portalDomain = `portal-${label.toLowerCase()}-${suffix}.example.test`;
        await addPortalDomain(tenant, portalDomain);
        const firstName = `Name${label}${suffix}`;
        const userId = await createUser(db, tenant, {
          email: sharedEmail,
          username: `client-${label}-${suffix}`,
          first_name: firstName,
          last_name: 'Client',
          user_type: 'client',
          hashed_password: `original-hash-${label}-${suffix}`,
        });
        await createUser(db, tenant, {
          email: sharedInternalEmail,
          username: `internal-${label}-${suffix}`,
          first_name: `Internal${label}`,
          last_name: 'User',
          user_type: 'internal',
        });
        return { tenant, userId, firstName, portalDomain, slug: buildTenantPortalSlug(tenant), password: `original-hash-${label}-${suffix}` };
      };
      if (first === 'A') {
        orgA = await make('A');
        orgB = await make('B');
      } else {
        orgB = await make('B');
        orgA = await make('A');
      }
    }

    async function expectSingleEmailFrom(org: Org, other: Org): Promise<CapturedEmail> {
      const emails = await capturedEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toContain(sharedEmail);
      expect(emails[0].from).toContain(`reset-${org === orgA ? 'a' : 'b'}-`);
      expect(await sentTenants()).toEqual([org.tenant]);
      const info = await getInfoFromToken(tokenOf(emails[0]));
      expect(info.errorType).toBeNull();
      expect(info.userInfo?.tenant).toBe(org.tenant);
      expect(info.userInfo?.user_id).toBe(org.userId);
      expect(info.userInfo?.tenant).not.toBe(other.tenant);
      expect(emails[0].text).toContain(`portalDomain=${org.portalDomain}`);
      return emails[0];
    }

    describe.each(['A', 'B'] as const)('users inserted %s first', (first) => {
      beforeAll(async () => {
        await buildFixture(first);
      }, HOOK_TIMEOUT);

      beforeEach(async () => {
        await db('email_sending_logs').whereIn('tenant', [orgA.tenant, orgB.tenant]).del();
        await TenantEmailService.invalidateTenantSettings(orgA.tenant);
        await TenantEmailService.invalidateTenantSettings(orgB.tenant);
      });

      // T001
      it("A's portal domain sends exactly one email through A, naming A's user", async () => {
        expect(await recoverPassword(sharedEmail, 'client', { portalDomain: orgA.portalDomain })).toBe(true);
        await expectSingleEmailFrom(orgA, orgB);
      });

      it("B's portal domain sends exactly one email through B, naming B's user", async () => {
        expect(await recoverPassword(sharedEmail, 'client', { portalDomain: orgB.portalDomain })).toBe(true);
        await expectSingleEmailFrom(orgB, orgA);
      });

      it('the legacy string form of the third argument still hints the portal domain', async () => {
        expect(await recoverPassword(sharedEmail, 'client', orgA.portalDomain)).toBe(true);
        await expectSingleEmailFrom(orgA, orgB);
      });

      // T002
      it("redeeming A's token changes only A's hash and shows A's name; likewise B", async () => {
        for (const [org, other] of [[orgA, orgB], [orgB, orgA]] as const) {
          await host.reset('smtp-sink');
          await recoverPassword(sharedEmail, 'client', { portalDomain: org.portalDomain });
          const [email] = await capturedEmails();
          const token = tokenOf(email);

          const info = await getAccountInfoFromToken(token, 'client');
          expect(info?.name).toBe(`${org.firstName} Client`);

          const otherBefore = await hashOf(other);
          const ownBefore = await hashOf(org);
          expect(await setNewPassword('Brand-new-Passw0rd!', token)).toBe(true);
          expect(await hashOf(org)).not.toBe(ownBefore);
          expect(await hashOf(other)).toBe(otherBefore);
        }
      });

      // T003
      it('with no hint, sends one email per tenant, each bound to its own user and portal domain', async () => {
        expect(await recoverPassword(sharedEmail, 'client')).toBe(true);
        const emails = await capturedEmails();
        expect(emails).toHaveLength(2);
        expect((await sentTenants()).sort()).toEqual([orgA.tenant, orgB.tenant].sort());
        for (const org of [orgA, orgB]) {
          const mine = emails.filter((e) => e.text.includes(`portalDomain=${org.portalDomain}`));
          expect(mine).toHaveLength(1);
          const info = await getInfoFromToken(tokenOf(mine[0]));
          expect(info.userInfo?.tenant).toBe(org.tenant);
          expect(info.userInfo?.user_id).toBe(org.userId);
        }
      });

      it('an inactive subject is skipped without suppressing the other tenant', async () => {
        await tenantDb(db, orgA.tenant).table('users').where({ user_id: orgA.userId }).update({ is_inactive: true });
        try {
          expect(await recoverPassword(sharedEmail, 'client')).toBe(true);
          const emails = await capturedEmails();
          expect(emails).toHaveLength(1);
          expect(await sentTenants()).toEqual([orgB.tenant]);
          expect((await getInfoFromToken(tokenOf(emails[0]))).userInfo?.user_id).toBe(orgB.userId);

          // A hint at the inactive tenant sends nothing: it never falls through to B.
          await host.reset('smtp-sink');
          await db('email_sending_logs').whereIn('tenant', [orgA.tenant, orgB.tenant]).del();
          expect(await recoverPassword(sharedEmail, 'client', { portalDomain: orgA.portalDomain })).toBe(true);
          expect(await capturedEmails()).toHaveLength(0);
        } finally {
          await tenantDb(db, orgA.tenant).table('users').where({ user_id: orgA.userId }).update({ is_inactive: false });
        }
      });

      it('an SSO-required internal subject is skipped without suppressing the other tenant', async () => {
        const settings = tenantDb(db, orgA.tenant).table('tenant_settings');
        const existing = await settings.where({ tenant: orgA.tenant }).first();
        const next = { ...(typeof existing?.settings === 'object' ? existing.settings : {}), sso: { requireSsoForInternalUsers: true } };
        if (existing) {
          await tenantDb(db, orgA.tenant).table('tenant_settings').where({ tenant: orgA.tenant }).update({ settings: JSON.stringify(next) });
        } else {
          await tenantDb(db, orgA.tenant).table('tenant_settings').insert({ tenant: orgA.tenant, settings: JSON.stringify(next) });
        }
        invalidateTenantAuthPolicyCache(orgA.tenant);
        try {
          expect(await recoverPassword(sharedInternalEmail, 'msp')).toBe(true);
          const emails = await capturedEmails();
          expect(emails).toHaveLength(1);
          expect(await sentTenants()).toEqual([orgB.tenant]);
          const info = await getInfoFromToken(tokenOf(emails[0]));
          expect(info.userInfo?.tenant).toBe(orgB.tenant);
        } finally {
          if (existing) {
            await tenantDb(db, orgA.tenant).table('tenant_settings').where({ tenant: orgA.tenant }).update({ settings: JSON.stringify(existing.settings) });
          } else {
            await tenantDb(db, orgA.tenant).table('tenant_settings').where({ tenant: orgA.tenant }).del();
          }
          invalidateTenantAuthPolicyCache(orgA.tenant);
        }
      });

      // T006
      it('returns the same value for match, hint mismatch, fan-out and over-limit; over the limit sends nothing', async () => {
        const results: unknown[] = [];
        results.push(await recoverPassword(sharedEmail, 'client', { portalDomain: orgA.portalDomain }));
        results.push(await recoverPassword(sharedEmail, 'client'));
        results.push(await recoverPassword(`nobody-${uuidv4().slice(0, 6)}@example.com`, 'client', { portalDomain: orgA.portalDomain }));
        await host.reset('smtp-sink');
        limitMock.mockResolvedValueOnce({ success: false });
        results.push(await recoverPassword(sharedEmail, 'client'));
        expect(results).toEqual([true, true, true, true]);
        expect(await capturedEmails()).toHaveLength(0);
        expect(limitMock).toHaveBeenCalledWith(sharedEmail);
      });

      // T008
      it("an MSP slug hint sends only that tenant's email; no hint sends both", async () => {
        expect(await recoverPassword(sharedInternalEmail, 'msp', { tenantSlug: orgB.slug })).toBe(true);
        let emails = await capturedEmails();
        expect(emails).toHaveLength(1);
        expect(await sentTenants()).toEqual([orgB.tenant]);
        const info = await getInfoFromToken(tokenOf(emails[0]));
        expect(info.userInfo?.tenant).toBe(orgB.tenant);
        expect(info.userInfo?.user_type).toBe('internal');

        await host.reset('smtp-sink');
        await db('email_sending_logs').whereIn('tenant', [orgA.tenant, orgB.tenant]).del();
        expect(await recoverPassword(sharedInternalEmail, 'msp', { tenantSlug: 'not-a-slug' })).toBe(true);
        emails = await capturedEmails();
        expect(emails).toHaveLength(2);
      });
    });
  });
});
