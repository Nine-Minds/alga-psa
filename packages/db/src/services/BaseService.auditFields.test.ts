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
import { BaseService, UnsupportedRangeFilterError, type ServiceContext } from './BaseService';

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
    return this.addCreateAuditFields({} as Knex, data, context);
  }

  async filterUpdateAuditFields(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.addUpdateAuditFields({} as Knex, data, context);
  }

  async filterData(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.filterAuditFields({} as Knex, data);
  }
}

class TargetTableService extends BaseService<Record<string, unknown>> {
  constructor(private readonly columnsByTable: Record<string, Set<string>>) {
    super({ tableName: 'contract_lines' });
  }

  protected async getTableColumns(_conn: Knex | Knex.Transaction, targetTable = this.tableName): Promise<Set<string>> {
    return this.columnsByTable[targetTable] ?? new Set();
  }

  async filterCreateForTarget(data: Record<string, unknown>, target: string): Promise<Record<string, unknown>> {
    return this.addCreateAuditFields({} as Knex, data, context, target);
  }
}

type RecordedWhere = { column: string; op?: string; value: unknown };

class RecordingQueryBuilder {
  readonly wheres: RecordedWhere[] = [];

  where(column: string, opOrValue?: unknown, value?: unknown): this {
    if (value === undefined) {
      this.wheres.push({ column, value: opOrValue });
    } else {
      this.wheres.push({ column, op: String(opOrValue), value });
    }
    return this;
  }

  whereIn(column: string, value: unknown): this {
    this.wheres.push({ column, value });
    return this;
  }

  whereILike(): this {
    return this;
  }
}

class FilterService extends BaseService<Record<string, unknown>> {
  constructor() {
    super({ tableName: 'audit_fields_filter' });
  }

  protected async getTableColumns(): Promise<Set<string>> {
    return new Set(['tenant', 'created_at', 'updated_at']);
  }

  runFilters(filters: Record<string, unknown>): RecordedWhere[] {
    const builder = new RecordingQueryBuilder();
    this.applyFilters(builder as unknown as Knex.QueryBuilder, filters);
    return builder.wheres;
  }

  runRangeFilters(
    filters: Record<string, unknown>,
    columns: Record<string, string | null>,
  ): RecordedWhere[] {
    const builder = new RecordingQueryBuilder();
    this.applyRangeFilters(builder as unknown as Knex.QueryBuilder, filters, columns);
    return builder.wheres;
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

  it('stamps and filters update audit fields against the target table', async () => {
    const service = new TestService('audit_fields_update_partial', new Set(['name', 'tenant', 'updated_at']));

    const result = await service.filterUpdateAuditFields({ name: 'Renamed' });

    expect(result.name).toBe('Renamed');
    expect(result).toHaveProperty('updated_at');
    expect(result).not.toHaveProperty('updated_by');
  });

  it('maps generic created_/updated_ range keys to their timestamp columns', () => {
    const service = new FilterService();

    expect(service.runFilters({
      created_from: '2026-01-01',
      created_to: '2026-02-01',
      updated_from: '2026-01-15',
      updated_to: '2026-02-15',
    })).toEqual([
      { column: 'created_at', op: '>=', value: '2026-01-01' },
      { column: 'created_at', op: '<=', value: '2026-02-01' },
      { column: 'updated_at', op: '>=', value: '2026-01-15' },
      { column: 'updated_at', op: '<=', value: '2026-02-15' },
    ]);
  });

  it('rejects a declared-but-unsupported range key (null mapping)', () => {
    const service = new FilterService();

    // A declared key mapped to null is a range key this resource cannot serve;
    // a dropped filter would return unfiltered rows, so fail loudly.
    expect(() => service.runRangeFilters({ updated_from: '2026-01-01' }, { updated_from: null }))
      .toThrow(UnsupportedRangeFilterError);
    expect(() => service.runRangeFilters({ updated_from: '2026-01-01' }, { updated_from: null }))
      .toThrow(/Unsupported range filter "updated_from"/);
  });

  it('treats a key absent from the map as a normal filter, not a range key', () => {
    const service = new FilterService();

    // `assigned_to` ends in `_to` but is not declared as a range key, so it must
    // be applied as a plain column filter rather than rejected.
    expect(service.runFilters({ assigned_to: 'user-1' })).toEqual([
      { column: 'assigned_to', value: 'user-1' },
    ]);
    expect(service.runRangeFilters({ assigned_to: 'user-1' }, {
      created_from: 'created_at',
    })).toEqual([]);
  });

  it('applies non-range keys and mapped ranges together', () => {
    const service = new FilterService();

    expect(service.runFilters({
      is_active: true,
      status: ['draft', 'sent'],
      created_from: '2026-01-01',
    })).toEqual([
      { column: 'created_at', op: '>=', value: '2026-01-01' },
      { column: 'is_active', value: true },
      { column: 'status', value: ['draft', 'sent'] },
    ]);
  });

  it('filters audit fields against an explicit target table, not the service default', async () => {
    // `contract_lines` has created_by/updated_by but the `contracts` target table
    // does not (hand-rolled insert in ContractLineService.createContract).
    const service = new TargetTableService({
      contract_lines: new Set(['tenant', 'created_by', 'updated_by', 'created_at', 'updated_at']),
      contracts: new Set(['tenant', 'created_at', 'updated_at']),
    });

    const result = await service.filterCreateForTarget({ name: 'Acme' }, 'contracts');

    expect(result).toMatchObject({ name: 'Acme', tenant: context.tenant });
    expect(result).not.toHaveProperty('created_by');
    expect(result).not.toHaveProperty('updated_by');
    expect(result).toHaveProperty('created_at');
    expect(result).toHaveProperty('updated_at');
  });
});
