import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import { resolveOutboundSender } from '@alga-psa/email/senderIdentity';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(process.cwd(), 'migrations/20260926100000_add_outbound_email_senders.cjs'));
const repairMigration = require(path.resolve(process.cwd(), 'migrations/20260926110000_clear_non_microsoft_sender_links.cjs'));
const timeout = 300_000;
let db: Knex;
const tenantIds: string[] = [];

async function seedTenant(input: { provider: 'smtp' | 'microsoft' | 'resend'; email?: string; name?: string; providerName?: string; verifiedDomain?: boolean; matchingMicrosoftMailbox?: boolean }) {
  const tenant = randomUUID();
  tenantIds.push(tenant);
  await db('tenants').insert({ tenant, client_name: `Outbound migration ${tenant.slice(0, 6)}`, email: `${tenant}@example.test` });
  const from = 'notifications@fallback.test';
  await tenantDb(db, tenant).table('tenant_email_settings').insert({
    tenant,
    email_provider: input.provider === 'microsoft' ? 'microsoft' : input.provider,
    default_from_domain: 'fallback.test',
    ticketing_from_email: input.email ?? null,
    ticketing_from_name: input.name ?? null,
    provider_configs: JSON.stringify([{ providerId: 'default', providerType: input.provider === 'microsoft' ? 'microsoft' : input.provider, isEnabled: true, config: { from, fromName: 'Example MSP' } }]),
    fallback_enabled: true,
    tracking_enabled: false,
  });
  if (input.verifiedDomain) {
    await tenantDb(db, tenant).table('email_domains').insert({ tenant, domain_name: input.email!.split('@')[1], status: 'verified' });
  }
  if ((input.provider === 'microsoft' || input.matchingMicrosoftMailbox) && input.email) {
    await tenantDb(db, tenant).table('email_providers').insert({
      id: randomUUID(), tenant, provider_type: 'microsoft', provider_name: 'Mailbox', mailbox: input.email,
      sender_display_name: input.providerName ?? null, is_active: true, status: 'connected',
    });
  }
  return { tenant, expected: input.email ? { email: input.email.toLowerCase(), name: input.name || input.providerName || undefined } : { email: from, name: input.name || 'Example MSP' } };
}

describe('outbound sender migration backfill against populated database', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    await migration.down(db);
    await seedTenant({ provider: 'smtp', email: 'support@verified.test', name: 'Support', verifiedDomain: true });
    await seedTenant({ provider: 'smtp', name: 'Name only' });
    await seedTenant({ provider: 'microsoft', email: 'projects@microsoft.test', providerName: 'Projects' });
    await seedTenant({ provider: 'smtp', email: 'support@shared.test', matchingMicrosoftMailbox: true });
    await seedTenant({ provider: 'resend', name: 'Support' });
    await migration.up(db);
  }, timeout);

  afterAll(async () => {
    if (db) await db.destroy();
  }, timeout);

  it('preserves legacy From values for email/name, name-only, and Microsoft mailbox matches', async () => {
    for (const tenant of [...tenantIds.slice(0, 3), tenantIds[3]!]) {
      const row = await tenantDb(db, tenant).table('tenant_email_settings').first();
      const senders = await tenantDb(db, tenant).table('email_sender_addresses').select('*');
      const routes = await tenantDb(db, tenant).table('email_sender_routes').select('*');
      const providerConfigs = typeof row.provider_configs === 'string' ? JSON.parse(row.provider_configs) : row.provider_configs;
      const resolved = resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket' }, {
        tenantId: tenant,
        defaultFromDomain: row.default_from_domain,
        ticketingFromEmail: row.ticketing_from_email,
        ticketingFromName: row.ticketing_from_name,
        customDomains: [], emailProvider: row.email_provider, providerConfigs, trackingEnabled: false,
        createdAt: row.created_at, updatedAt: row.updated_at, outboundSenders: senders, outboundRoutes: routes,
      }, 'Example MSP');
      const expectedEmail = row.ticketing_from_email?.toLowerCase() ?? 'notifications@fallback.test';
      const expectedName = row.ticketing_from_name?.trim() || (row.email_provider === 'microsoft' && row.ticketing_from_email
        ? await tenantDb(db, tenant).table('email_providers').where({ mailbox: row.ticketing_from_email }).first('sender_display_name').then((p: any) => p?.sender_display_name || 'Support')
        : row.ticketing_from_email ? 'Support' : 'Name only');
      expect(resolved.from).toEqual({ email: expectedEmail, ...(expectedName ? { name: expectedName } : {}) });
      if (row.email_provider === 'microsoft') {
        const mailbox = await tenantDb(db, tenant).table('email_providers').where({ mailbox: row.ticketing_from_email }).first('id');
        expect(resolved.microsoftProviderId).toBe(mailbox.id);
      } else {
        expect(resolved.microsoftProviderId).toBeUndefined();
      }
    }

    const smtpTenant = tenantIds[3]!;
    const smtpSender = await tenantDb(db, smtpTenant).table('email_sender_addresses').first();
    const smtpRoute = await tenantDb(db, smtpTenant).table('email_sender_routes').where({ route_type: 'mail_class', mail_class: 'ticket' }).first();
    expect(smtpSender).toMatchObject({ email_address: 'support@shared.test', microsoft_provider_id: null });
    expect(smtpRoute).toMatchObject({ sender_id: smtpSender.sender_id });
  }, timeout);

  it('repairs pre-existing Microsoft links on non-Microsoft tenants', async () => {
    const tenant = tenantIds[3]!;
    const provider = await tenantDb(db, tenant).table('email_providers').first('id');
    const sender = await tenantDb(db, tenant).table('email_sender_addresses').first('sender_id');
    await tenantDb(db, tenant).table('email_sender_addresses').where({ sender_id: sender.sender_id })
      .update({ microsoft_provider_id: provider.id });

    await repairMigration.up(db);

    const repaired = await tenantDb(db, tenant).table('email_sender_addresses').where({ sender_id: sender.sender_id }).first();
    const route = await tenantDb(db, tenant).table('email_sender_routes').where({ route_type: 'mail_class', mail_class: 'ticket' }).first();
    expect(repaired.microsoft_provider_id).toBeNull();
    expect(route.sender_id).toBe(sender.sender_id);
  }, timeout);

  it('preserves name-only legacy routing when a Resend domain has no verified domain row', async () => {
    const tenant = tenantIds[4]!;
    const row = await tenantDb(db, tenant).table('tenant_email_settings').first();
    const sender = await tenantDb(db, tenant).table('email_sender_addresses').first();
    const route = await tenantDb(db, tenant).table('email_sender_routes').first();
    expect(await tenantDb(db, tenant).table('email_domains').where({ status: 'verified' }).first()).toBeUndefined();
    expect(sender).toBeUndefined();
    expect(route).toMatchObject({ sender_id: null, display_name: 'Support' });
    const providerConfigs = typeof row.provider_configs === 'string' ? JSON.parse(row.provider_configs) : row.provider_configs;
    const resolved = resolveOutboundSender({ tenantId: tenant, mailClass: 'ticket' }, {
      tenantId: tenant, defaultFromDomain: row.default_from_domain, ticketingFromEmail: row.ticketing_from_email,
      ticketingFromName: row.ticketing_from_name, customDomains: [], emailProvider: row.email_provider,
      providerConfigs, trackingEnabled: false, createdAt: row.created_at, updatedAt: row.updated_at,
      outboundSenders: [], outboundRoutes: [route],
    }, 'Example MSP');
    expect(resolved.from).toEqual({ email: 'notifications@fallback.test', name: 'Support' });
  }, timeout);
});
