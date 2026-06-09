/**
 * Hudu Integration Contracts
 *
 * TypeScript types for the Hudu API v1 resources used in Phase 1 (pull-only):
 * companies, assets, articles, asset_passwords. Derived from the local Hudu
 * API reference (ee/docs/plans/2026-06-08-hudu-integration/hudu-api-reference.md).
 *
 * SECURITY: the `password` field on HuduAssetPassword is plaintext. It is only
 * ever populated by a single reveal GET and must never be persisted (DB/Vault/
 * cache) or logged. List payloads carry metadata only (see HuduAssetPasswordSummary).
 */

export const HUDU_INTEGRATION_TYPE = 'hudu' as const;

/** UI label -> API resource name. Always hit the API name. */
export type HuduResource = 'companies' | 'assets' | 'articles' | 'asset_passwords';

/** Hudu Company (client/organization). */
export interface HuduCompany {
  id: number;
  name: string;
  /** PSA id Hudu stamps on imported companies; may equal an Alga client_id. */
  id_in_integration?: number | string | null;
  integration_slug?: string | null;
  /** Relative or absolute deep-link to the company in Hudu. */
  url?: string | null;
  nickname?: string | null;
  company_type?: string | null;
  parent_company_id?: number | null;
  archived?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Hudu Asset (server/workstation/device/etc.). */
export interface HuduAsset {
  id: number;
  company_id: number;
  name: string;
  /** Asset layout / template name. */
  asset_type?: string | null;
  primary_serial?: string | null;
  primary_model?: string | null;
  primary_mail?: string | null;
  url?: string | null;
  archived?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Hudu Article (knowledge-base document). */
export interface HuduArticle {
  id: number;
  company_id?: number | null;
  name: string;
  /** Article folder name, when present. */
  folder_id?: number | null;
  url?: string | null;
  enable_sharing?: boolean | null;
  draft?: boolean | null;
  archived?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Hudu Asset Password (company-scoped credential).
 *
 * SECURITY: `password` is plaintext and only present on a single reveal GET.
 * Never persist or log it. Use HuduAssetPasswordSummary for list payloads.
 */
export interface HuduAssetPassword {
  id: number;
  company_id: number;
  name: string;
  username?: string | null;
  /** SECURITY: plaintext; reveal-only, never persisted or logged. */
  password?: string | null;
  url?: string | null;
  password_folder_name?: string | null;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Metadata-only projection of an asset password (no value field). */
export type HuduAssetPasswordSummary = Omit<HuduAssetPassword, 'password'>;

/** Collection responses are keyed by the plural resource name. */
export interface HuduCompaniesResponse {
  companies: HuduCompany[];
}
export interface HuduAssetsResponse {
  assets: HuduAsset[];
}
export interface HuduArticlesResponse {
  articles: HuduArticle[];
}
export interface HuduAssetPasswordsResponse {
  asset_passwords: HuduAssetPassword[];
}

/** Single-resource responses are keyed by the singular resource name. */
export interface HuduCompanyResponse {
  company: HuduCompany;
}
export interface HuduAssetPasswordResponse {
  asset_password: HuduAssetPassword;
}
