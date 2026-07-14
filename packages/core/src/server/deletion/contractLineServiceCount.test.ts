import { describe, expect, it, vi } from 'vitest';
import { DELETION_CONFIGS } from '../../config/deletion/index';

function findCountQuery() {
  const dep = DELETION_CONFIGS.service.dependencies.find((d) => d.type === 'contract_line_service');
  if (!dep || !dep.countQuery) {
    throw new Error('contract_line_service dependency is missing its countQuery');
  }
  return dep.countQuery;
}

function makeBuilder(count: number) {
  const builder: any = {};
  const joinClause = {
    on: vi.fn().mockReturnThis(),
    andOn: vi.fn().mockReturnThis()
  };
  builder.join = vi.fn((_table: string, callback: (this: typeof joinClause) => void) => {
    callback.call(joinClause);
    return builder;
  });
  builder.where = vi.fn().mockReturnValue(builder);
  builder.count = vi.fn().mockReturnValue(builder);
  builder.first = vi.fn().mockResolvedValue({ count: String(count) });
  return { builder, joinClause };
}

describe('DELETION_CONFIGS.service contract_line_service countQuery', () => {
  it('joins contract_lines so orphan rows are excluded from the count', async () => {
    const countQuery = findCountQuery();
    const { builder, joinClause } = makeBuilder(3);
    const trx = vi.fn().mockReturnValue(builder) as any;

    const count = await countQuery(trx, { tenant: 't-1', entityId: 'svc-1' });

    expect(trx).toHaveBeenCalledWith('contract_line_services as cls');
    expect(builder.join).toHaveBeenCalledTimes(1);
    expect(builder.join.mock.calls[0][0]).toBe('contract_lines as cl');
    expect(joinClause.on).toHaveBeenCalledWith(
      'cl.contract_line_id',
      '=',
      'cls.contract_line_id'
    );
    expect(joinClause.andOn).toHaveBeenCalledWith('cl.tenant', '=', 'cls.tenant');
    expect(builder.where).toHaveBeenNthCalledWith(1, 'cls.tenant', 't-1');
    expect(builder.where).toHaveBeenNthCalledWith(2, {
      'cls.service_id': 'svc-1'
    });
    expect(count).toBe(3);
  });

  it('returns 0 when no live contract-line references exist', async () => {
    const countQuery = findCountQuery();
    const { builder } = makeBuilder(0);
    const trx = vi.fn().mockReturnValue(builder) as any;

    const count = await countQuery(trx, { tenant: 't-1', entityId: 'svc-orphan-only' });

    expect(count).toBe(0);
  });
});
