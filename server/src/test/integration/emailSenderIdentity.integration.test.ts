import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import {
  resolveDefaultFromAddress,
  resolveTenantCompanyName,
  TenantEmailService,
} from '@alga-psa/email';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

describe('email sender identity integration', () => {
  let db: Knex;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    db = await createTestDbConnection();
  });

  afterAll(async () => {
    for (const tenantId of tenantIds) {
      const scoped = tenantDb(db, tenantId);
      await scoped.table('tenant_email_settings').delete();
      await scoped.table('tenant_companies').delete();
      await scoped.table('clients').delete();
      await scoped.unscoped('tenants', 'email sender identity integration fixture cleanup')
        .where({ tenant: tenantId })
        .delete();
    }
    if (db) {
      await db.destroy();
    }
  });

  async function createTenantFixture(params: {
    tenantName: string;
    clientName?: string;
    withDefaultClient?: boolean;
  }) {
    const tenantId = uuidv4();
    const clientId = uuidv4();
    tenantIds.push(tenantId);
    const scoped = tenantDb(db, tenantId);

    await scoped.unscoped('tenants', 'email sender identity integration fixture setup').insert({
      tenant: tenantId,
      client_name: params.tenantName,
      email: `tenant-${tenantId.slice(0, 8)}@example.test`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    if (params.clientName) {
      await scoped.table('clients').insert({
        tenant: tenantId,
        client_id: clientId,
        client_name: params.clientName,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });
      if (params.withDefaultClient !== false) {
        await scoped.table('tenant_companies').insert({
          tenant: tenantId,
          client_id: clientId,
          is_default: true,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        });
      }
    }

    await scoped.table('tenant_email_settings').insert({
      tenant: tenantId,
      default_from_domain: 'example.test',
      email_provider: 'smtp',
      provider_configs: JSON.stringify([{
        providerId: 'smtp-provider',
        providerType: 'smtp',
        isEnabled: true,
        config: { from: 'notifications@example.test', fromName: '' },
      }]),
      tracking_enabled: false,
      fallback_enabled: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    return { tenantId, clientId };
  }

  it('resolves a blank provider name from the current default client without persisting it', async () => {
    const { tenantId, clientId } = await createTenantFixture({
      tenantName: 'Tenant Record Name',
      clientName: 'Example MSP',
    });

    const settings = await TenantEmailService.getTenantEmailSettings(tenantId, db);
    const companyName = await resolveTenantCompanyName(db, tenantId);

    expect(companyName).toBe('Example MSP');
    expect(resolveDefaultFromAddress(settings, companyName)).toEqual({
      email: 'notifications@example.test',
      name: 'Example MSP',
    });
    expect(settings?.providerConfigs[0]?.config.fromName).toBe('');

    await tenantDb(db, tenantId).table('clients')
      .where({ client_id: clientId })
      .update({ client_name: 'Renamed MSP' });

    expect(await resolveTenantCompanyName(db, tenantId)).toBe('Renamed MSP');
    const stored = await tenantDb(db, tenantId).table('tenant_email_settings').first('provider_configs');
    const providerConfigs = typeof stored.provider_configs === 'string'
      ? JSON.parse(stored.provider_configs)
      : stored.provider_configs;
    expect(providerConfigs[0].config.fromName).toBe('');
  });

  it('falls back to the tenant record and never reads another tenant default client', async () => {
    const first = await createTenantFixture({
      tenantName: 'Fallback Tenant Name',
      withDefaultClient: false,
    });
    await createTenantFixture({
      tenantName: 'Other Tenant',
      clientName: 'Other Tenant MSP',
    });

    expect(await resolveTenantCompanyName(db, first.tenantId)).toBe('Fallback Tenant Name');
  });
});
