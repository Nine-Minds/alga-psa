import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ tenant: 'test-tenant' })),
}));

import { findOrCreateCurrentBucketUsageRecord } from '../src/services/bucketUsageService';

describe('scheduling bucketUsageService period selection', () => {
  it('uses the previous client billing cycle when rollover periods follow canonical client cadence', async () => {
    const state = {
      clientBillingCycleCalls: 0,
      bucketUsageFirstCalls: 0,
      insertedRecord: null as Record<string, unknown> | null,
    };

    const trx: any = ((tableName: string) => {
      const builder: any = {};
      builder.where = vi.fn().mockImplementation(() => builder);
      builder.andWhere = vi.fn().mockImplementation(() => builder);
      builder.whereNotNull = vi.fn().mockImplementation(() => builder);
      builder.join = vi.fn().mockImplementation(() => builder);
      builder.leftJoin = vi.fn().mockImplementation(() => builder);
      builder.andOn = vi.fn().mockImplementation(() => builder);
      builder.andOnVal = vi.fn().mockImplementation(() => builder);
      builder.orderBy = vi.fn().mockImplementation(() => builder);
      builder.select = vi.fn().mockImplementation(() => builder);

      builder.first = vi.fn().mockImplementation(async () => {
        if (tableName === 'client_contract_lines as ccl') {
          return {
            contract_line_id: 'plan-1',
            start_date: '2024-12-15',
            billing_frequency: 'monthly',
          };
        }

        if (tableName === 'client_billing_cycles') {
          state.clientBillingCycleCalls += 1;
          if (state.clientBillingCycleCalls === 1) {
            return {
              period_start_date: '2025-02-01',
              period_end_date: '2025-03-01',
            };
          }

          return {
            period_start_date: '2025-01-01',
            period_end_date: '2025-02-01',
          };
        }

        if (tableName === 'bucket_usage') {
          state.bucketUsageFirstCalls += 1;
          if (state.bucketUsageFirstCalls === 1) {
            return undefined;
          }

          return {
            usage_id: 'usage-prev',
            tenant: 'test-tenant',
            client_id: 'client-1',
            contract_line_id: 'plan-1',
            service_catalog_id: 'service-1',
            period_start: '2025-01-01',
            period_end: '2025-01-31',
            minutes_used: 1800,
            overage_minutes: 0,
            rolled_over_minutes: 0,
          };
        }

        if (tableName === 'contract_line_service_configuration') {
          return {
            config_id: 'bucket-config-1',
          };
        }

        if (tableName === 'contract_line_service_bucket_config') {
          return {
            config_id: 'bucket-config-1',
            contract_line_id: 'plan-1',
            service_catalog_id: 'service-1',
            total_minutes: 2400,
            allow_rollover: true,
            tenant: 'test-tenant',
          };
        }

        return undefined;
      });

      builder.insert = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        state.insertedRecord = payload;
        return {
          returning: vi.fn().mockResolvedValue([
            {
              usage_id: 'usage-new',
              ...payload,
            },
          ]),
        };
      });

      return builder;
    }) as any;

    trx.client = {
      config: {
        tenant: 'test-tenant',
      },
    };
    trx.fn = {
      now: () => 'NOW',
    };

    const record = await findOrCreateCurrentBucketUsageRecord(
      trx,
      'client-1',
      'service-1',
      '2025-02-10T00:00:00Z',
    );

    expect(state.insertedRecord).toMatchObject({
      tenant: 'test-tenant',
      client_id: 'client-1',
      contract_line_id: 'plan-1',
      service_catalog_id: 'service-1',
      period_start: '2025-02-01',
      period_end: '2025-02-28',
      rolled_over_minutes: 600,
    });
    expect(record).toMatchObject({
      usage_id: 'usage-new',
      period_start: '2025-02-01',
      period_end: '2025-02-28',
      rolled_over_minutes: 600,
    });
  });
});
