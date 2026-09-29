import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { createDefaultDeps, evaluateInboundEmailRules } from '../../../../shared/services/email/inboundEmailRules/engine';
import type { InboundEmailRule } from '../../../../shared/services/email/inboundEmailRules/types';

describe('inbound email rule client matchers (integration)', () => {
  let db: Knex;
  let tenant: string;
  const ids = { activeA: randomUUID(), activeB: randomUUID(), inactive: randomUUID() };
  const names = {
    unique: `unique-${randomUUID()}`,
    normalized: `Norm  ${randomUUID()}`,
    duplicate: `duplicate-${randomUUID()}`,
    repeated: `repeated-${randomUUID()}`,
    inactive: `inactive-${randomUUID()}`,
  };
  const contactIds = { primary: randomUUID(), additional: randomUUID(), inactive: randomUUID(), noClient: randomUUID(), nullableActive: randomUUID() };

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection({ runSeeds: true });
    const tenantRow = await db('tenants').select('tenant').first();
    if (!tenantRow) throw new Error('Integration database has no seeded tenant');
    tenant = tenantRow.tenant;
    const clientColumns = await db('clients').columnInfo();
    const companyColumns = await db('companies').columnInfo();
    const clientRows = [
      { id: ids.activeA, name: `Matcher A ${ids.activeA.slice(0, 8)}`, inactive: false },
      { id: ids.activeB, name: `Matcher B ${ids.activeB.slice(0, 8)}`, inactive: false },
      { id: ids.inactive, name: `Matcher inactive ${ids.inactive.slice(0, 8)}`, inactive: true },
    ];
    for (const client of clientRows) {
      const legacy = pickColumns(companyColumns, {
        tenant, company_id: client.id, company_name: client.name, status: 'active', type: 'customer',
      });
      if (Object.keys(companyColumns).length) await db('companies').insert(legacy);
      await db('clients').insert(pickColumns(clientColumns, {
        tenant, client_id: client.id, client_name: client.name, billing_cycle: 'monthly',
        is_tax_exempt: false, is_inactive: client.inactive,
      }));
    }
    const assetColumns = await db('assets').columnInfo();
    const assets = [
      [names.unique, ids.activeA],
      [names.normalized.toLowerCase().replace(/\s+/g, ' '), ids.activeA],
      [names.duplicate, ids.activeA], [names.duplicate, ids.activeB],
      [names.repeated, ids.activeA], [names.repeated, ids.activeA],
      [names.inactive, ids.inactive],
    ] as const;
    for (const [name, clientId] of assets) {
      await db('assets').insert(pickColumns(assetColumns, {
        tenant, asset_id: randomUUID(), type_id: randomUUID(), client_id: clientId, company_id: clientId,
        asset_tag: randomUUID(), asset_type: 'workstation', name, status: 'active',
      }));
    }
    const contactColumns = await db('contacts').columnInfo();
    const contacts = [
      // Direct writes can leave legacy mixed-case primary addresses in the table.
      [contactIds.primary, ids.activeA, 'PRIMARY-MATCH@EXAMPLE.TEST', false],
      [contactIds.additional, ids.activeB, 'primary-additional@example.test', false],
      [contactIds.inactive, ids.activeA, 'inactive-match@example.test', true],
      [contactIds.nullableActive, ids.activeA, 'nullable-active@example.test', null],
      [contactIds.noClient, null, 'no-client-match@example.test', false],
    ] as const;
    for (const [contactId, clientId, email, inactive] of contacts) {
      await db('contacts').insert(pickColumns(contactColumns, {
        tenant, contact_name_id: contactId, client_id: clientId, full_name: email,
        email, is_inactive: inactive,
      }));
    }
    await db('contact_additional_email_addresses').insert({
      tenant, contact_additional_email_address_id: randomUUID(), contact_name_id: contactIds.additional,
      email_address: 'secondary-match@example.test', canonical_type: 'work', display_order: 0,
    });
  }, 180_000);

  afterAll(async () => { await db?.destroy(); });

  it('matches normalized asset names, rejects cross-client ambiguity and ignores inactive clients', async () => {
    expect(await runRule('asset_name', names.unique)).toMatchObject({ clientId: ids.activeA, assetId: expect.any(String) });
    expect(await runRule('asset_name', names.normalized.toUpperCase())).toMatchObject({ clientId: ids.activeA });
    expect((await runRule('asset_name', names.normalized.toUpperCase()))?.assetId).toEqual(expect.any(String));
    const duplicate = await runRule('asset_name', names.duplicate);
    expect(duplicate).toBeNull();
    const ambiguous = await evaluate('asset_name', names.duplicate);
    expect(ambiguous.trace[0].clientMatchAmbiguity).toEqual([{ target: 'asset_name', clientCount: 2 }]);
    expect(await runRule('asset_name', names.repeated)).toMatchObject({ clientId: ids.activeA });
    expect((await runRule('asset_name', names.repeated))?.assetId).toBeUndefined();
    expect(await runRule('asset_name', names.inactive)).toBeNull();
  });

  it('matches active contacts by primary and additional email, excluding inactive and unassigned contacts', async () => {
    expect(await runRule('contact_email', 'primary-match@example.test')).toMatchObject({ clientId: ids.activeA, contactId: contactIds.primary });
    expect(await runRule('contact_email', 'secondary-match@example.test')).toMatchObject({ clientId: ids.activeB, contactId: contactIds.additional });
    expect(await runRule('contact_email', 'inactive-match@example.test')).toBeNull();
    expect(await runRule('contact_email', 'nullable-active@example.test')).toMatchObject({ clientId: ids.activeA, contactId: contactIds.nullableActive });
    expect(await runRule('contact_email', 'no-client-match@example.test')).toBeNull();
  });

  it('uses the normalized-name expression index for the production asset lookup', async () => {
    await db.transaction(async (trx) => {
      await trx.raw('SET LOCAL enable_seqscan = off');
      const explain = await trx.raw(`EXPLAIN SELECT asset_id, client_id FROM assets WHERE tenant = ? AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = ? LIMIT 50`, [tenant, names.unique.toLowerCase()]);
      const output = explain.rows.map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN']).join('\n');
      expect(output).toContain('idx_assets_tenant_normalized_name');
    });
  });

  async function runRule(target: 'asset_name' | 'contact_email', value: string) {
    const result = await evaluate(target, value);
    return result.outcome.kind === 'assign_client' ? result.outcome : null;
  }

  async function evaluate(target: 'asset_name' | 'contact_email', value: string) {
    const deps = {
      ...createDefaultDeps(),
      loadRules: async (): Promise<InboundEmailRule[]> => [{
        tenant, id: randomUUID(), name: 'matcher integration', is_active: true, position: 1,
        provider_ids: null, conditions: [{ field: 'subject', operator: 'contains', value: 'matcher' }],
        action_type: 'extract_assign_client', action_config: {
          source: 'body_text', extraction: { type: 'after', marker: 'Match:' }, match_by: [target],
        }, on_no_match: 'proceed', fallback_inbound_ticket_defaults_id: null,
      }],
    } as any;
    return evaluateInboundEmailRules({ tenantId: tenant, providerId: 'integration-provider', emailData: {
      id: randomUUID(), from: { email: 'alerts@example.test' }, to: [{ email: 'help@example.test' }],
      subject: 'matcher integration', body: { text: `Match: ${value}` },
    }, deps });
  }
});

function pickColumns(columns: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([column]) => column in columns));
}
