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
  let tenantId: string;
  let internalEmail: string;
  let clientEmail: string;
  let inactiveInternalEmail: string;
  let unknownEmail: string;

  const envBackup: Record<string, string | undefined> = {
    EMAIL_ENABLE: undefined,
    SECRET_KEY: undefined,
    NEXT_PUBLIC_BASE_URL: undefined,
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
    loggerError.mockClear();
    loggerWarn.mockClear();
    loggerInfo.mockClear();
    loggerDebug.mockClear();
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
    const smtpPort = ports['smtp-sink'];

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
});
