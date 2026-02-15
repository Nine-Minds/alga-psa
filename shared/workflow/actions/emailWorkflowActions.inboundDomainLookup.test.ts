import { describe, expect, it, vi } from 'vitest';

let trxImpl: any = null;

vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: async (fn: any) => fn(trxImpl),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(),
}));

import { findClientIdByInboundEmailDomain } from './emailWorkflowActions';

function makeInboundDomainLookupTrx(params: { row: null | { client_id: string } }) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhereRaw: vi.fn().mockReturnThis(),
    first: vi.fn(async () => params.row),
  };

  const trx: any = (tableName: string) => {
    expect(tableName).toBe('client_inbound_email_domains');
    return builder;
  };

  return { trx, builder };
}

describe('emailWorkflowActions: findClientIdByInboundEmailDomain', () => {
  it('returns null when no mapping exists for the domain', async () => {
    const { trx } = makeInboundDomainLookupTrx({ row: null });
    trxImpl = trx;

    await expect(findClientIdByInboundEmailDomain('example.com', 'tenant-1')).resolves.toBeNull();
  });

  it('returns the client_id when a mapping exists (domain normalization)', async () => {
    const { trx, builder } = makeInboundDomainLookupTrx({ row: { client_id: 'client-1' } });
    trxImpl = trx;

    await expect(findClientIdByInboundEmailDomain(' Example.COM ', 'tenant-1')).resolves.toBe('client-1');
    expect(builder.andWhereRaw).toHaveBeenCalledWith('lower(domain) = ?', ['example.com']);
  });
});

