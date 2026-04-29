import { beforeEach, describe, expect, it } from 'vitest';
import { listAvailableAssetFactsForAsset, upsertAssetFact } from './assetFactsService';

type DbState = {
  asset_facts: Array<any>;
};

let state: DbState;
let knexMock: any;

function createFakeKnex(db: DbState) {
  class QB {
    private whereClauses: Array<Record<string, any>> = [];
    private orderByClauses: Array<{ col: string; dir: 'asc' | 'desc' }> = [];

    constructor(private readonly table: string) {}

    where(where: Record<string, any>) {
      this.whereClauses.push(where);
      return this;
    }

    orderBy(col: string, dir: 'asc' | 'desc') {
      this.orderByClauses.push({ col, dir });
      return this;
    }

    insert(data: any) {
      if (this.table !== 'asset_facts') throw new Error('Unsupported table insert');
      const existing = db.asset_facts.find((row) =>
        row.tenant === data.tenant &&
        row.asset_id === data.asset_id &&
        row.source_type === data.source_type &&
        row.namespace === data.namespace &&
        row.fact_key === data.fact_key
      );

      if (!existing) {
        db.asset_facts.push({ ...data, asset_fact_id: data.asset_fact_id || `fact_${db.asset_facts.length + 1}` });
      }

      return {
        onConflict: () => ({
          merge: (patch: Record<string, unknown>) => {
            if (existing) {
              Object.assign(existing, patch);
            }
            return Promise.resolve();
          },
        }),
      };
    }

    then(resolve: (value: any[]) => void) {
      let rows = [...db.asset_facts];
      for (const where of this.whereClauses) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const order of this.orderByClauses.reverse()) {
        rows.sort((a, b) => (String(a[order.col] || '').localeCompare(String(b[order.col] || ''))) * (order.dir === 'asc' ? 1 : -1));
      }
      resolve(rows);
      return Promise.resolve(rows as any);
    }
  }

  const knex: any = (table: string) => new QB(table);
  knex.fn = { now: () => new Date('2026-04-29T12:00:00.000Z') };
  return knex;
}

describe('assetFactsService', () => {
  beforeEach(() => {
    state = { asset_facts: [] };
    knexMock = createFakeKnex(state);
  });

  it('T001: inserts and reads an available Tanium fact with tenant-scoped predicates', async () => {
    await upsertAssetFact(knexMock, {
      tenant: 'tenant_a',
      assetId: 'asset_1',
      sourceType: 'integration',
      provider: 'tanium',
      integrationId: 'integration_1',
      namespace: 'tanium',
      factKey: 'criticality',
      label: 'Tanium Criticality',
      valueText: 'High',
      valueNumber: 1.67,
      valueJson: { sensorName: 'Endpoint Criticality with Level' },
      source: 'tanium.gateway.sensor.Endpoint Criticality with Level',
      isAvailable: true,
    });

    const tenantAFacts = await listAvailableAssetFactsForAsset(knexMock, { tenant: 'tenant_a', assetId: 'asset_1' });
    const tenantBFacts = await listAvailableAssetFactsForAsset(knexMock, { tenant: 'tenant_b', assetId: 'asset_1' });

    expect(tenantAFacts).toHaveLength(1);
    expect(tenantAFacts[0]).toMatchObject({
      provider: 'tanium',
      namespace: 'tanium',
      fact_key: 'criticality',
      value_text: 'High',
      is_available: true,
    });
    expect(tenantBFacts).toEqual([]);
  });

  it('T002: enforces uniqueness for current fact key while allowing different tenants/assets/keys', async () => {
    await upsertAssetFact(knexMock, {
      tenant: 'tenant_a', assetId: 'asset_1', sourceType: 'integration', provider: 'tanium', integrationId: 'integration_1',
      namespace: 'tanium', factKey: 'criticality', label: 'Tanium Criticality', valueText: 'Low', valueNumber: 1, valueJson: {}, source: 'src', isAvailable: true,
    });
    await upsertAssetFact(knexMock, {
      tenant: 'tenant_a', assetId: 'asset_1', sourceType: 'integration', provider: 'tanium', integrationId: 'integration_1',
      namespace: 'tanium', factKey: 'criticality', label: 'Tanium Criticality', valueText: 'Critical', valueNumber: 2, valueJson: {}, source: 'src', isAvailable: true,
    });
    await upsertAssetFact(knexMock, {
      tenant: 'tenant_b', assetId: 'asset_1', sourceType: 'integration', provider: 'tanium', integrationId: 'integration_1',
      namespace: 'tanium', factKey: 'criticality', label: 'Tanium Criticality', valueText: 'Medium', valueNumber: 1.33, valueJson: {}, source: 'src', isAvailable: true,
    });
    await upsertAssetFact(knexMock, {
      tenant: 'tenant_a', assetId: 'asset_1', sourceType: 'integration', provider: 'tanium', integrationId: 'integration_1',
      namespace: 'tanium', factKey: 'other_fact', label: 'Other', valueText: 'yes', valueJson: {}, source: 'src', isAvailable: true,
    });

    expect(state.asset_facts.filter((row) => row.tenant === 'tenant_a' && row.asset_id === 'asset_1' && row.fact_key === 'criticality')).toHaveLength(1);
    expect(state.asset_facts.find((row) => row.tenant === 'tenant_a' && row.asset_id === 'asset_1' && row.fact_key === 'criticality')?.value_text).toBe('Critical');
    expect(state.asset_facts.find((row) => row.tenant === 'tenant_b' && row.fact_key === 'criticality')).toBeTruthy();
    expect(state.asset_facts.find((row) => row.tenant === 'tenant_a' && row.fact_key === 'other_fact')).toBeTruthy();
  });

  it('T003: explicit no-result marks unavailable and preserves raw provider metadata', async () => {
    await upsertAssetFact(knexMock, {
      tenant: 'tenant_a', assetId: 'asset_1', sourceType: 'integration', provider: 'tanium', integrationId: 'integration_1',
      namespace: 'tanium', factKey: 'criticality', label: 'Tanium Criticality', valueText: 'High', valueNumber: 1.67, valueJson: { before: true }, source: 'src', isAvailable: true,
    });

    await upsertAssetFact(knexMock, {
      tenant: 'tenant_a', assetId: 'asset_1', sourceType: 'integration', provider: 'tanium', integrationId: 'integration_1',
      namespace: 'tanium', factKey: 'criticality', label: 'Tanium Criticality', valueText: null, valueNumber: null,
      valueJson: { sensorName: 'Endpoint Criticality with Level', reason: 'endpoint_missing_or_unavailable' }, source: 'src', isAvailable: false,
    });

    const row = state.asset_facts[0];
    expect(row.is_available).toBe(false);
    expect(row.value_text).toBeNull();
    expect(row.value_number).toBeNull();
    expect(row.value_json).toMatchObject({ reason: 'endpoint_missing_or_unavailable' });
  });
});
