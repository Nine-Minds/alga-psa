/**
 * Unit tests for CompanyAccountingSyncService
 * (packages/billing/src/services/companySync/companySyncService.ts).
 *
 * The service decides whether a company already maps to an external
 * accounting entity, finds-or-creates it through the adapter, and persists
 * the mapping idempotently. Repository and adapter are injected fakes.
 */
import { describe, expect, it, vi } from 'vitest';
import { CompanyAccountingSyncService } from '../../src/services/companySync/companySyncService';
import type {
  AccountingCompanyAdapter,
  CompanyMappingLookupResult,
  EnsureCompanyMappingParams,
  NormalizedCompanyPayload,
} from '../../src/services/companySync/companySync.types';

const payload: NormalizedCompanyPayload = { companyId: 'co-1', name: 'Acme Co' };

function makeParams(overrides: Partial<EnsureCompanyMappingParams> = {}): EnsureCompanyMappingParams {
  return {
    companyId: 'co-1',
    payload,
    adapterType: 'quickbooks_online',
    tenantId: 'tenant-1',
    targetRealm: 'realm-1',
    ...overrides,
  };
}

function makeRepo(initial: CompanyMappingLookupResult | null = null) {
  let stored: CompanyMappingLookupResult | null = initial;
  return {
    stored: () => stored,
    findCompanyMapping: vi.fn(async () => stored),
    upsertCompanyMapping: vi.fn(async (record: any) => {
      stored = { externalCompanyId: record.externalCompanyId, metadata: record.metadata ?? null };
    }),
  };
}

function makeAdapter(overrides: Partial<AccountingCompanyAdapter> = {}): AccountingCompanyAdapter {
  return {
    type: 'quickbooks_online',
    findExternalCompany: vi.fn(async () => null),
    createOrUpdateExternalCompany: vi.fn(async () => ({
      externalId: 'qbo-77',
      displayName: 'Acme Co',
      raw: { Id: 'qbo-77' },
    })),
    ...overrides,
  } as AccountingCompanyAdapter;
}

describe('CompanyAccountingSyncService.ensureCompanyMapping', () => {
  it('returns an existing mapping without calling the adapter', async () => {
    const repo = makeRepo({ externalCompanyId: 'qbo-1', metadata: { Id: 'qbo-1' } });
    const adapter = makeAdapter();
    const service = CompanyAccountingSyncService.create({
      mappingRepository: repo,
      adapterFactory: () => adapter,
    });

    const result = await service.ensureCompanyMapping(makeParams());

    expect(result).toEqual({ externalCompanyId: 'qbo-1', metadata: { Id: 'qbo-1' } });
    expect(adapter.findExternalCompany).not.toHaveBeenCalled();
    expect(repo.upsertCompanyMapping).not.toHaveBeenCalled();
  });

  it('reuses a matching external company instead of creating a duplicate', async () => {
    const repo = makeRepo(null);
    const adapter = makeAdapter({
      findExternalCompany: vi.fn(async () => ({
        externalId: 'qbo-existing',
        displayName: 'Acme Co',
        raw: { Id: 'qbo-existing' },
      })),
    });
    const service = CompanyAccountingSyncService.create({
      mappingRepository: repo,
      adapterFactory: () => adapter,
    });

    const result = await service.ensureCompanyMapping(makeParams());

    expect(adapter.createOrUpdateExternalCompany).not.toHaveBeenCalled();
    expect(repo.upsertCompanyMapping).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      adapterType: 'quickbooks_online',
      algaCompanyId: 'co-1',
      externalCompanyId: 'qbo-existing',
      targetRealm: 'realm-1',
      metadata: { Id: 'qbo-existing' },
    });
    expect(result.externalCompanyId).toBe('qbo-existing');
  });

  it('creates the external company when none is found, then persists and returns the mapping', async () => {
    const repo = makeRepo(null);
    const adapter = makeAdapter();
    const service = CompanyAccountingSyncService.create({
      mappingRepository: repo,
      adapterFactory: () => adapter,
    });

    const result = await service.ensureCompanyMapping(makeParams());

    expect(adapter.findExternalCompany).toHaveBeenCalledWith(payload, {
      tenantId: 'tenant-1',
      targetRealm: 'realm-1',
    });
    expect(adapter.createOrUpdateExternalCompany).toHaveBeenCalledOnce();
    expect(result).toEqual({ externalCompanyId: 'qbo-77', metadata: { Id: 'qbo-77' } });
  });

  it('caches resolved mappings per tenant/adapter/realm/company within the service instance', async () => {
    const repo = makeRepo({ externalCompanyId: 'qbo-1', metadata: null });
    const service = CompanyAccountingSyncService.create({
      mappingRepository: repo,
      adapterFactory: () => makeAdapter(),
    });

    await service.ensureCompanyMapping(makeParams());
    await service.ensureCompanyMapping(makeParams());
    expect(repo.findCompanyMapping).toHaveBeenCalledTimes(1);

    // A different realm must not hit the cache entry.
    await service.ensureCompanyMapping(makeParams({ targetRealm: 'realm-2' }));
    expect(repo.findCompanyMapping).toHaveBeenCalledTimes(2);
  });

  it('survives a unique-violation race on upsert by re-reading the winning mapping', async () => {
    const winner: CompanyMappingLookupResult = { externalCompanyId: 'qbo-winner', metadata: null };
    const findCompanyMapping = vi
      .fn()
      .mockResolvedValueOnce(null) // initial lookup: no mapping yet
      .mockResolvedValueOnce(winner); // re-read after conflict
    const upsertError = Object.assign(new Error('duplicate key'), { code: '23505' });
    const repo = {
      findCompanyMapping,
      upsertCompanyMapping: vi.fn(async () => {
        throw upsertError;
      }),
    };
    const service = CompanyAccountingSyncService.create({
      mappingRepository: repo,
      adapterFactory: () => makeAdapter(),
    });

    const result = await service.ensureCompanyMapping(makeParams());

    expect(result).toEqual(winner);
  });

  it('falls back to the adapter-resolved company when the post-conflict re-read finds nothing', async () => {
    const upsertError = Object.assign(new Error('duplicate key'), { code: '23505' });
    const repo = {
      findCompanyMapping: vi.fn(async () => null),
      upsertCompanyMapping: vi.fn(async () => {
        throw upsertError;
      }),
    };
    const service = CompanyAccountingSyncService.create({
      mappingRepository: repo,
      adapterFactory: () => makeAdapter(),
    });

    const result = await service.ensureCompanyMapping(makeParams());

    expect(result).toEqual({ externalCompanyId: 'qbo-77', metadata: { Id: 'qbo-77' } });
  });

  it('propagates non-unique-violation persistence errors', async () => {
    const repo = {
      findCompanyMapping: vi.fn(async () => null),
      upsertCompanyMapping: vi.fn(async () => {
        throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
      }),
    };
    const service = CompanyAccountingSyncService.create({
      mappingRepository: repo,
      adapterFactory: () => makeAdapter(),
    });

    await expect(service.ensureCompanyMapping(makeParams())).rejects.toThrow('connection reset');
  });

  it('throws a clear error when no adapter is registered for the requested type', async () => {
    const service = CompanyAccountingSyncService.create({
      mappingRepository: makeRepo(null),
      adapterFactory: () => null,
    });

    await expect(service.ensureCompanyMapping(makeParams({ adapterType: 'xero' }))).rejects.toThrow(
      'Company adapter xero is not registered'
    );
  });
});
