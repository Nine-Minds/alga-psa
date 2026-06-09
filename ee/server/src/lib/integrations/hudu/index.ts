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

// TODO(hudu-client): export huduClient + credential resolution (F010-F017).
// TODO(connection): export hudu_integrations model/repository (F023).
// TODO(company-mapping-data): export mapping/suggest helpers (F040-F046).
