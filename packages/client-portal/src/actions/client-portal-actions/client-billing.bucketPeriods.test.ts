import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const clientBillingSource = readFileSync(new URL('./client-billing.ts', import.meta.url), 'utf8');

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

function buildThenableQuery(result: any, extras: Record<string, any> = {}) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.andWhere = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.join = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
  builder.first = vi.fn().mockResolvedValue(result);
  builder.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  builder.catch = (onRejected: any) => Promise.resolve(result).catch(onRejected);
  builder.finally = (handler: any) => Promise.resolve(result).finally(handler);
  Object.assign(builder, extras);
  return builder;
}

describe('client billing bucket period actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T12:00:00.000Z'));
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      contact_id: 'contact-1',
      tenant: 'tenant-1',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('T124: getCurrentUsage selects the active bucket period with end-exclusive boundaries', () => {
    expect(clientBillingSource).toContain("const currentDate = new Date().toISOString().slice(0, 10);");
    expect(clientBillingSource).toContain(".andWhere('period_start', '<=', currentDate)");
    expect(clientBillingSource).toContain(".andWhere('period_end', '>', currentDate)");
    expect(clientBillingSource).toContain(".orderBy('period_start', 'desc')");
    expect(clientBillingSource).not.toContain(".whereRaw('? BETWEEN period_start AND period_end'");
  });

  it('returns remaining bucket units with explicit allowance period boundaries from getClientBucketUsage', async () => {
    const userQuery = {
      where: vi.fn(() => ({
        first: vi.fn().mockResolvedValue({ contact_id: 'contact-1' }),
      })),
    };
    const contactQuery = {
      where: vi.fn(() => ({
        first: vi.fn().mockResolvedValue({ client_id: 'client-1' }),
      })),
    };
    const bucketRows = [
      {
        contract_line_id: 'line-1',
        contract_line_name: 'Support Bucket',
        service_id: 'service-1',
        service_name: 'Help Desk',
        total_minutes: 600,
        minutes_used: 120,
        rolled_over_minutes: 60,
        period_start: new Date('2026-01-01T00:00:00.000Z'),
        period_end: new Date('2026-02-01T00:00:00.000Z'),
      },
    ];
    const detailedBucketQuery = buildThenableQuery(bucketRows);

    const trx: any = Object.assign(
      (table: string) => {
        if (table === 'users') {
          return userQuery;
        }
        if (table === 'contacts') {
          return contactQuery;
        }
        if (table === 'client_contract_lines as ccl') {
          return detailedBucketQuery;
        }
        throw new Error(`Unexpected table: ${table}`);
      },
      {
        raw: vi.fn((sql: string, bindings?: any[]) => ({ sql, bindings })),
      }
    );

    createTenantKnexMock.mockResolvedValue({ knex: vi.fn() });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) => callback(trx));

    const { getClientBucketUsage } = await import('./client-billing-metrics');
    const [bucket] = await getClientBucketUsage();

    expect(bucket).toMatchObject({
      contract_line_id: 'line-1',
      service_id: 'service-1',
      total_minutes: 600,
      minutes_used: 120,
      rolled_over_minutes: 60,
      remaining_minutes: 540,
      period_start: '2026-01-01',
      period_end: '2026-02-01',
      hours_total: 11,
      hours_used: 2,
      hours_remaining: 9,
    });
  });
});
