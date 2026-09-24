import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { knex as createKnex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getPlaywrightDbConfig } from '../../../ee/server/src/__tests__/integration/utils/playwrightDatabaseConfig';
import { assetWarrantyEndSource } from '../src/lib/dateTriggers/sources/assetWarrantyEnd';
import { clientAnniversarySource } from '../src/lib/dateTriggers/sources/clientAnniversary';
import { contractRenewalDecisionSource } from '../src/lib/dateTriggers/sources/contractRenewalDecision';

const enabled = process.env.DATE_TRIGGER_INTEGRATION === '1';

describe.skipIf(!enabled)('date trigger source database integration', () => {
  const config = getPlaywrightDbConfig();
  const db = createKnex({
    client: 'pg',
    connection: { host: config.host, port: config.port, database: config.database, user: config.adminUser, password: config.adminPassword, ssl: config.ssl },
    pool: { min: 0, max: 2 },
  });

  afterAll(async () => { await db.destroy(); });

  it('finds the tenant-local anniversary and non-retired warranty date, excluding retired assets', async () => {
    const tenant = await db('tenants').first('tenant');
    if (!tenant) throw new Error('The integration database must have its standard tenant seed.');
    const tenantId = tenant.tenant as string;
    const clientId = uuidv4();
    const activeAssetId = uuidv4();
    const retiredAssetId = uuidv4();
    const contractId = uuidv4();
    const clientContractId = uuidv4();

    const trx = await db.transaction();
    try {
      await trx('tenant_settings').where({ tenant: tenantId }).update({
        settings: trx.raw("COALESCE(settings, '{}'::jsonb) || '{\"timezone\":\"UTC\"}'::jsonb"),
      });
      await trx('clients').insert({
        tenant: tenantId,
        client_id: clientId,
        client_name: `Date trigger fixture ${clientId}`,
        client_since: '2020-06-15',
        created_at: '2020-06-15T00:00:00.000Z',
        updated_at: '2020-06-15T00:00:00.000Z',
      });
      await trx('assets').insert([
        { tenant: tenantId, asset_id: activeAssetId, asset_tag: `date-${activeAssetId}`, name: 'Active warranty fixture', status: 'active', asset_type: 'hardware', client_id: clientId, warranty_end_date: '2099-06-15T18:30:00.000Z' },
        { tenant: tenantId, asset_id: retiredAssetId, asset_tag: `date-${retiredAssetId}`, name: 'Retired warranty fixture', status: 'retired', asset_type: 'hardware', client_id: clientId, warranty_end_date: '2099-06-15T18:30:00.000Z' },
      ]);
      await trx('contracts').insert({ tenant: tenantId, contract_id: contractId, contract_name: `Date trigger contract ${contractId}` });
      await trx('client_contracts').insert({
        tenant: tenantId,
        client_contract_id: clientContractId,
        client_id: clientId,
        contract_id: contractId,
        start_date: '2020-01-01T00:00:00.000Z',
        decision_due_date: '2099-06-15',
        renewal_cycle_key: '2099-06-15:1',
        renewal_mode: 'manual',
        is_active: true,
      });

      const anniversaries = await clientAnniversarySource.findOccurrences(trx, tenantId, '2099-06-15', '2099-06-15');
      const warranties = await assetWarrantyEndSource.findOccurrences(trx, tenantId, '2099-06-15', '2099-06-15');
      const renewals = await contractRenewalDecisionSource.findOccurrences(trx, tenantId, '2099-06-15', '2099-06-15');

      expect(anniversaries.find((row) => row.entityId === clientId)).toMatchObject({ occursOn: '2099-06-15', payload: { yearsAsClient: 79, anniversarySource: 'client_since' } });
      expect(warranties.filter((row) => [activeAssetId, retiredAssetId].includes(row.entityId))).toEqual([
        expect.objectContaining({
          entityId: activeAssetId,
          occursOn: '2099-06-15',
          payload: expect.objectContaining({ assetName: 'Active warranty fixture', warrantyEndDate: '2099-06-15' }),
        }),
      ]);
      expect(renewals.find((row) => row.entityId === clientContractId)).toMatchObject({
        occursOn: '2099-06-15', cycleKey: '2099-06-15:1', payload: { contractId, clientContractId, renewalMode: 'manual' },
      });
    } finally {
      await trx.rollback();
    }
  });
});
