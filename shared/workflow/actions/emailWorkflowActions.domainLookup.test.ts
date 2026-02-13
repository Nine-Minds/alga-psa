import { describe, expect, it, vi } from 'vitest';

let trxImpl: any = null;

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: async (fn: any) => fn(trxImpl),
}));

import { findUniqueClientIdByContactEmailDomain } from './emailWorkflowActions';

function makeContactsDomainLookupTrx(params: { rows: Array<{ client_id: string }> }) {
  const builder: any = {
    distinct: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    whereNotNull: vi.fn().mockReturnThis(),
    andWhereRaw: vi.fn(async () => params.rows),
  };

  const trx: any = (tableName: string) => {
    expect(tableName).toBe('contacts');
    return builder;
  };

  return { trx, builder };
}

describe('emailWorkflowActions: findUniqueClientIdByContactEmailDomain', () => {
  it('returns null when no contacts exist for the domain', async () => {
    const { trx } = makeContactsDomainLookupTrx({ rows: [] });
    trxImpl = trx;

    await expect(findUniqueClientIdByContactEmailDomain('example.com', 'tenant-1')).resolves.toBeNull();
  });
});

