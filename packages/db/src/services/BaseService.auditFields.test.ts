import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import logger from '@alga-psa/core/logger';
import { BaseService, type ServiceContext } from './BaseService';

const context: ServiceContext = {
  tenant: 'tenant-1',
  userId: 'user-1',
};

class TestService extends BaseService<Record<string, unknown>> {
  constructor(tableName: string, private readonly columns: Set<string>) {
    super({ tableName });
  }

  protected async getTableColumns(): Promise<Set<string>> {
    return this.columns;
  }

  async filterCreateAuditFields(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.filterAuditFields(
      {} as Knex,
      this.addCreateAuditFields(data, context)
    );
  }

  async filterData(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.filterAuditFields({} as Knex, data);
  }
}

describe('BaseService audit field filtering', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });

  it('keeps create audit fields that exist and removes the missing update fields', async () => {
    const service = new TestService(
      'audit_fields_partial',
      new Set(['name', 'tenant', 'created_by', 'created_at'])
    );

    const result = await service.filterCreateAuditFields({ name: 'New status' });

    expect(result).toMatchObject({
      name: 'New status',
      tenant: context.tenant,
      created_by: context.userId,
    });
    expect(result.created_at).toEqual(expect.any(String));
    expect(result).not.toHaveProperty('updated_by');
    expect(result).not.toHaveProperty('updated_at');
  });

  it('leaves audit fields unchanged when the table contains all of them', async () => {
    const service = new TestService(
      'audit_fields_complete',
      new Set(['created_by', 'created_at', 'updated_by', 'updated_at'])
    );
    const data = {
      created_by: 'creator',
      created_at: '2026-07-17T00:00:00.000Z',
      updated_by: 'updater',
      updated_at: '2026-07-17T01:00:00.000Z',
    };

    await expect(service.filterData(data)).resolves.toEqual(data);
  });

  it('does not hide unknown non-audit fields', async () => {
    const service = new TestService('audit_fields_unknown', new Set());

    await expect(service.filterData({ bogus_column: 'still invalid' })).resolves.toEqual({
      bogus_column: 'still invalid',
    });
  });

  it('warns only once for each missing table and audit field pair', async () => {
    const service = new TestService('audit_fields_warning', new Set());

    await service.filterData({ updated_by: 'user-1' });
    await service.filterData({ updated_by: 'user-2' });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[db/BaseService] table "audit_fields_warning" has no column "updated_by"; skipping audit field'
    );
  });
});
