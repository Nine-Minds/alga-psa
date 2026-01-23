export type AccountingAdapterType =
  | 'xero'
  | 'xero_csv'
  | 'quickbooks_online'
  | 'quickbooks_desktop'
  | 'quickbooks_csv';

export interface NormalizedCompanyAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface NormalizedCompanyContact {
  type: 'primary' | 'billing' | 'shipping';
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface NormalizedCompanyPayload {
  companyId: string;
  name: string;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  billingAddress?: NormalizedCompanyAddress | null;
  shippingAddress?: NormalizedCompanyAddress | null;
  contacts?: NormalizedCompanyContact[];
  taxNumber?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ExternalCompanyRecord {
  externalId: string;
  displayName: string;
  syncToken?: string | null;
  raw?: Record<string, unknown>;
}

export interface CompanyMappingRecord {
  tenantId: string;
  adapterType: AccountingAdapterType;
  algaCompanyId: string;
  externalCompanyId: string;
  targetRealm?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CompanyMappingLookupResult {
  externalCompanyId: string;
  metadata?: Record<string, unknown> | null;
}

export interface CompanyAdapterContext {
  tenantId: string;
  targetRealm?: string | null;
}

export interface EnsureCompanyMappingParams {
  companyId: string;
  payload: NormalizedCompanyPayload;
  adapterType: AccountingAdapterType;
  tenantId: string;
  targetRealm?: string | null;
}

export interface AccountingCompanyAdapter {
  readonly type: AccountingAdapterType;
  findExternalCompany(
    payload: NormalizedCompanyPayload,
    context: CompanyAdapterContext
  ): Promise<ExternalCompanyRecord | null>;
  createOrUpdateExternalCompany(
    payload: NormalizedCompanyPayload,
    context: CompanyAdapterContext
  ): Promise<ExternalCompanyRecord>;
}

export interface CompanyMappingRepository {
  findCompanyMapping(params: {
    tenantId: string;
    adapterType: AccountingAdapterType;
    companyId: string;
    targetRealm?: string | null;
  }): Promise<CompanyMappingLookupResult | null>;
  upsertCompanyMapping(record: CompanyMappingRecord): Promise<void>;
}

