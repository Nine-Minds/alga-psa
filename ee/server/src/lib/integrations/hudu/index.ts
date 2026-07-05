/**
 * Hudu Integration Module
 *
 * Barrel export for the Hudu integration library (EE-only).
 * Phase 1 is pull-only. Later commit groups add: huduClient.ts, secrets.ts,
 * mapping/suggest helpers, and data-fetch helpers.
 */

export { HUDU_INTEGRATION_TYPE, HUDU_MAPPING_TABLE } from './contracts';
export type {
  HuduResource,
  HuduCompany,
  HuduAsset,
  HuduAssetLayout,
  HuduAssetLayoutFieldDef,
  HuduAssetLayoutDetail,
  HuduArticle,
  HuduAssetPassword,
  HuduAssetPasswordSummary,
  HuduCompaniesResponse,
  HuduAssetsResponse,
  HuduArticlesResponse,
  HuduAssetPasswordsResponse,
  HuduCompanyResponse,
  HuduAssetLayoutResponse,
  HuduAssetPasswordResponse,
} from './contracts';

export {
  HuduClient,
  createHuduClient,
  mapHuduResource,
  toHuduError,
  redactSecret,
  buildHuduApiBaseUrl,
  HuduRequestError,
  HUDU_RESOURCE_MAP,
  DEFAULT_RETRY_OPTIONS,
} from './huduClient';
export type {
  HuduClientConfig,
  HuduResult,
  HuduError,
  HuduErrorKind,
  HuduValidationResult,
  HuduRetryOptions,
  HuduDomainResource,
} from './huduClient';

export {
  resolveHuduCredentials,
  HuduCredentialsError,
  HUDU_SECRET_KEYS,
  HUDU_ENV_VARS,
} from './secrets';
export type { HuduCredentials, HuduSecretKey } from './secrets';

export {
  getHuduIntegration,
  upsertHuduIntegration,
  setHuduIntegrationActive,
  touchHuduIntegrationLastSynced,
  mergeHuduSettings,
  setHuduSyncRunState,
} from './huduIntegrationRepository';
export type {
  HuduIntegrationRecord,
  UpsertHuduIntegrationInput,
  HuduSyncStatus,
  HuduSyncRunState,
} from './huduIntegrationRepository';

export {
  HUDU_MAPPING_ENTITY_TYPE,
  HUDU_MAPPING_SYNC_STATUS,
  HUDU_FUZZY_MATCH_THRESHOLD,
  HUDU_EXACT_NAME_CONFIDENCE,
  HUDU_INTEGRATION_ID_CONFIDENCE,
  HUDU_COMPANIES_CACHE_KEY,
  toCompanyCacheEntry,
  buildCompaniesCache,
  parseCompaniesCache,
  huduNameSimilarity,
  suggestHuduCompanyMappings,
  setHuduCompanyMappingRow,
  clearHuduCompanyMappingRow,
  getHuduCompanyMappingRows,
  resolveHuduCompanyIdForClient,
  resolveClientIdForHuduCompany,
} from './companyMapping';
export type {
  HuduCompanyCacheEntry,
  HuduCompaniesCache,
  HuduSuggestionSource,
  HuduMappingSuggestion,
  HuduMatcherClient,
  HuduMatcherCompany,
  HuduExistingMappingRef,
  HuduMappingMetadata,
  HuduCompanyMappingRow,
  HuduMappingErrorCode,
  HuduMappingWriteResult,
  SetHuduCompanyMappingInput,
  ClearHuduCompanyMappingRef,
} from './companyMapping';

export {
  HUDU_ASSET_LAYOUT_TYPE_MAP_KEY,
  HUDU_LAYOUT_EXCLUDED,
  ALGA_ASSET_TYPES,
  isAlgaAssetType,
  isHuduLayoutAssignment,
  isLayoutExcluded,
  normalizeAssetLayoutTypeMap,
  parseAssetLayoutTypeMap,
  getHuduAssetLayoutTypeMap,
  setHuduAssetLayoutTypeMap,
  suggestAssetTypeForLayout,
  resolveAssetTypeForLayout,
} from './assetLayoutMap';
export type { AlgaAssetType, HuduLayoutAssignment, HuduAssetLayoutTypeMap } from './assetLayoutMap';

export {
  deriveAssetFieldKey,
  parseHuduListSelectOptions,
  buildFieldsSchemaFromHuduLayout,
  projectHuduFieldsOntoSchema,
} from './layoutFieldSchema';
export type { HuduSchemaProjection } from './layoutFieldSchema';

export {
  HUDU_SERIAL_CONFIDENCE,
  suggestHuduAssetMappings,
} from './assetMatching';
export type {
  HuduAssetSuggestionSource,
  HuduAssetMappingSuggestion,
  HuduMatcherAsset,
  AlgaMatcherAsset,
  HuduAssetExistingMappingRef,
} from './assetMatching';

export {
  HUDU_REFERENCE_CACHE_TTL_MS,
  HUDU_REFERENCE_CACHE_MAX_ENTRIES,
  getCachedHuduList,
  setCachedHuduList,
  clearHuduReferenceCache,
  getHuduReferenceCacheSize,
  toHuduAssetPasswordSummary,
  huduInstanceBaseUrl,
  buildHuduRecordUrl,
  buildHuduCompanyUrl,
} from './referenceData';
export type {
  HuduReferenceResource,
  HuduReferenceCacheHit,
  HuduCompanyLinkSource,
} from './referenceData';

export { writeHuduPasswordRevealAudit } from './revealAudit';
export type { HuduPasswordRevealAuditParams } from './revealAudit';

export { runHuduTenantSync, resolveTenantAuditUserId } from './tenantSync';
export type { HuduTenantSyncSummary, RunHuduTenantSyncOptions } from './tenantSync';
