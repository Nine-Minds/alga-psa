/**
 * Hudu Integration Module
 *
 * Barrel export for the Hudu integration library (EE-only).
 * Phase 1 is pull-only. Later commit groups add: huduClient.ts, secrets.ts,
 * mapping/suggest helpers, and data-fetch helpers.
 */

export { HUDU_INTEGRATION_TYPE } from './contracts';
export type {
  HuduResource,
  HuduCompany,
  HuduAsset,
  HuduArticle,
  HuduAssetPassword,
  HuduAssetPasswordSummary,
  HuduCompaniesResponse,
  HuduAssetsResponse,
  HuduArticlesResponse,
  HuduAssetPasswordsResponse,
  HuduCompanyResponse,
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

// TODO(connection): export hudu_integrations model/repository (F023).
// TODO(company-mapping-data): export mapping/suggest helpers (F040-F046).
