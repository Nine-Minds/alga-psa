import {
  AccountingCompanyAdapter,
  AccountingAdapterType,
  CompanyAdapterContext,
  CompanyMappingLookupResult,
  CompanyMappingRepository,
  EnsureCompanyMappingParams,
  ExternalCompanyRecord,
  NormalizedCompanyPayload
} from './companySync.types';

export interface CompanySyncDependencies {
  mappingRepository: CompanyMappingRepository;
  adapterFactory: (type: AccountingAdapterType) => AccountingCompanyAdapter | null;
}

export class CompanyAccountingSyncService {
  static create(deps: CompanySyncDependencies): CompanyAccountingSyncService {
    return new CompanyAccountingSyncService(deps);
  }

  private mappingCache = new Map<string, CompanyMappingLookupResult>();

  private constructor(private readonly deps: CompanySyncDependencies) {}

  async ensureCompanyMapping(params: EnsureCompanyMappingParams): Promise<CompanyMappingLookupResult> {
    const cacheKey = this.buildCacheKey(params);
    if (this.mappingCache.has(cacheKey)) {
      return this.mappingCache.get(cacheKey)!;
    }

    const existing = await this.deps.mappingRepository.findCompanyMapping({
      tenantId: params.tenantId,
      adapterType: params.adapterType,
      companyId: params.companyId,
      targetRealm: params.targetRealm ?? null
    });
    if (existing) {
      this.mappingCache.set(cacheKey, existing);
      return existing;
    }

    const adapter = this.deps.adapterFactory(params.adapterType);
    if (!adapter) {
      throw new Error(`Company adapter ${params.adapterType} is not registered`);
    }

    const context: CompanyAdapterContext = {
      tenantId: params.tenantId,
      targetRealm: params.targetRealm ?? null
    };

    const resolved = await this.findOrCreateExternalCompany(adapter, params.payload, context);

    try {
      await this.deps.mappingRepository.upsertCompanyMapping({
        tenantId: params.tenantId,
        adapterType: params.adapterType,
        algaCompanyId: params.companyId,
        externalCompanyId: resolved.externalId,
        targetRealm: params.targetRealm ?? null,
        metadata: resolved.raw ?? null
      });
    } catch (error: any) {
      if (error?.code !== '23505') {
        throw error;
      }
    }

    const persisted =
      (await this.deps.mappingRepository.findCompanyMapping({
        tenantId: params.tenantId,
        adapterType: params.adapterType,
        companyId: params.companyId,
        targetRealm: params.targetRealm ?? null
      })) ??
      {
        externalCompanyId: resolved.externalId,
        metadata: resolved.raw ?? null
      };

    this.mappingCache.set(cacheKey, persisted);
    return persisted;
  }

  private buildCacheKey(params: EnsureCompanyMappingParams): string {
    return [
      params.tenantId,
      params.adapterType,
      params.targetRealm ?? 'default',
      params.companyId
    ].join(':');
  }

  private async findOrCreateExternalCompany(
    adapter: AccountingCompanyAdapter,
    payload: NormalizedCompanyPayload,
    context: CompanyAdapterContext
  ): Promise<ExternalCompanyRecord> {
    const existing = await adapter.findExternalCompany(payload, context);
    if (existing) {
      return existing;
    }
    return adapter.createOrUpdateExternalCompany(payload, context);
  }
}
