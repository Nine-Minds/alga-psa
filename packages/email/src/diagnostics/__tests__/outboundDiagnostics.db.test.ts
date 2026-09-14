/**
 * DB-backed outbound diagnostics resolution tests (T005/T006).
 *
 * These exercise the REAL tenant settings read + provider selection against a
 * migrated database. They are skipped unless an explicit opt-in points at a
 * database, so CI stays green:
 *
 *   OUTBOUND_DIAG_DB_TESTS=1
 *   OUTBOUND_DIAG_DB_HOST=127.0.0.1
 *   OUTBOUND_DIAG_DB_PORT=5472
 *   OUTBOUND_DIAG_DB_USER=app_user
 *   OUTBOUND_DIAG_DB_PASSWORD=<secret>
 *   OUTBOUND_DIAG_DB_NAME=server
 *
 * The suite creates isolated tenants and deletes them afterwards. It never
 * sends mail: the SMTP provider points at a closed local port so the connection
 * step fails fast without leaving the host, and live send is off.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knexLib, { type Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { runOutboundEmailDiagnostics } from '../outboundDiagnostics';

const enabled = process.env.OUTBOUND_DIAG_DB_TESTS === '1';

function resolvePassword(): string {
  if (process.env.OUTBOUND_DIAG_DB_PASSWORD) return process.env.OUTBOUND_DIAG_DB_PASSWORD;
  const candidates = [
    path.resolve(__dirname, '../../../../../secrets/db_password_server'),
    path.resolve(process.cwd(), 'secrets/db_password_server'),
  ];
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, 'utf8').trim();
    } catch {
      // try next
    }
  }
  return '';
}

function connect(): Knex {
  return knexLib({
    client: 'pg',
    connection: {
      host: process.env.OUTBOUND_DIAG_DB_HOST || '127.0.0.1',
      port: Number(process.env.OUTBOUND_DIAG_DB_PORT || 5472),
      user: process.env.OUTBOUND_DIAG_DB_USER || 'app_user',
      password: resolvePassword(),
      database: process.env.OUTBOUND_DIAG_DB_NAME || 'server',
    },
    pool: { min: 0, max: 2 },
  });
}

const suite = enabled ? describe : describe.skip;

suite('runOutboundEmailDiagnostics (DB-backed tenant resolution)', () => {
  let db: Knex;
  const tenantA = uuidv4();
  const tenantB = uuidv4();

  async function seedTenant(tenantId: string, clientName: string): Promise<void> {
    await db('tenants').insert({
      tenant: tenantId,
      client_name: clientName,
      email: `${tenantId.slice(0, 8)}@example.test`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }

  async function clearSettings(tenantId: string): Promise<void> {
    await db('tenant_email_settings').where({ tenant: tenantId }).del();
  }

  async function seedSmtpSettings(
    tenantId: string,
    options: { enabled: boolean; from: string; password?: string; host?: string },
  ): Promise<void> {
    await db('tenant_email_settings').insert({
      tenant: tenantId,
      default_from_domain: 'example.test',
      custom_domains: JSON.stringify([]),
      email_provider: 'smtp',
      provider_configs: JSON.stringify([
        {
          providerId: 'smtp-primary',
          providerType: 'smtp',
          isEnabled: options.enabled,
          config: {
            host: options.host ?? '127.0.0.1',
            port: 9,
            username: options.password ? 'diag-user' : '',
            password: options.password ?? '',
            from: options.from,
          },
        },
      ]),
      tracking_enabled: false,
      ticketing_from_email: 'ticketing@example.test',
      ticketing_from_name: 'Example MSP',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }

  beforeAll(async () => {
    db = connect();
    await db.raw('select 1');
    await seedTenant(tenantA, 'Outbound Diagnostics A');
    await seedTenant(tenantB, 'Outbound Diagnostics B');
  });

  afterAll(async () => {
    if (!db) return;
    await db('tenant_email_settings').whereIn('tenant', [tenantA, tenantB]).del();
    await db('tenants').whereIn('tenant', [tenantA, tenantB]).del();
    await db.destroy().catch(() => undefined);
  });

  it('resolves the saved enabled SMTP provider for the session tenant and dispatches provider steps', async () => {
    await clearSettings(tenantA);
    await seedSmtpSettings(tenantA, { enabled: true, from: 'outbound@example.test', password: 'super-secret' });

    const report = await runOutboundEmailDiagnostics({ tenant: tenantA, knex: db });

    const selection = report.steps.find((step) => step.id === 'outbound_provider_selected');
    expect(selection?.status).toBe('pass');
    expect(selection?.data).toMatchObject({
      providerType: 'smtp',
      configuredMailbox: 'outbound@example.test',
      ticketingFromEmail: 'ticketing@example.test',
      effectiveSender: 'outbound@example.test',
    });
    expect(report.summary.providerType).toBe('smtp');
    expect(report.summary.effectiveSender).toBe('outbound@example.test');
    expect(report.summary.ticketingFromEmail).toBe('ticketing@example.test');
    expect(report.steps.map((step) => step.id)).toEqual([
      'outbound_provider_selected',
      'smtp_configuration',
      'smtp_connection',
      'smtp_tls',
      'smtp_auth',
      'live_send_test',
    ]);
    // Live send is off by default and no message is sent.
    expect(report.summary.liveSendPerformed).toBe(false);
    // Secrets never reach the visible report or the exported bundle.
    expect(JSON.stringify(report)).not.toContain('super-secret');
  });

  it('fails provider selection when the saved provider is disabled and skips dependent work', async () => {
    await clearSettings(tenantA);
    await seedSmtpSettings(tenantA, { enabled: false, from: 'outbound@example.test' });

    const report = await runOutboundEmailDiagnostics({ tenant: tenantA, knex: db });

    const selection = report.steps.find((step) => step.id === 'outbound_provider_selected');
    expect(selection?.status).toBe('fail');
    expect(selection?.error?.message).toContain('No outbound email provider is enabled');
    expect(report.steps.find((step) => step.id === 'smtp_connection')).toBeUndefined();
    expect(report.steps.find((step) => step.id === 'outbound_provider_steps')?.status).toBe('skip');
    expect(report.summary.overallStatus).toBe('fail');
  });

  it('fails provider selection when the tenant has no saved settings', async () => {
    await clearSettings(tenantB);

    const report = await runOutboundEmailDiagnostics({ tenant: tenantB, knex: db });

    const selection = report.steps.find((step) => step.id === 'outbound_provider_selected');
    expect(selection?.status).toBe('fail');
    expect(selection?.error?.message).toContain('No outbound email settings are configured');
    expect(report.summary.providerId).toBe('');
    expect(report.summary.liveSendPerformed).toBe(false);
  });

  it('does not leak the configured tenant settings into a different tenant resolution', async () => {
    await clearSettings(tenantA);
    await seedSmtpSettings(tenantA, { enabled: true, from: 'outbound@example.test' });
    await clearSettings(tenantB);

    const reportA = await runOutboundEmailDiagnostics({ tenant: tenantA, knex: db });
    const reportB = await runOutboundEmailDiagnostics({ tenant: tenantB, knex: db });

    expect(reportA.steps.find((step) => step.id === 'outbound_provider_selected')?.status).toBe('pass');
    expect(reportA.summary.effectiveSender).toBe('outbound@example.test');
    expect(reportB.steps.find((step) => step.id === 'outbound_provider_selected')?.status).toBe('fail');
    expect(reportB.summary.providerId).toBe('');
    expect(reportB.summary.effectiveSender).toBeUndefined();
  });
});
