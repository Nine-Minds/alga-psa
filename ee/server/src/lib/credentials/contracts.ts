/**
 * Credentials vault shared contracts (EE-only).
 *
 * These types define the CredentialSource abstraction implemented by the native
 * Postgres store (nativeSource.ts) and the Hudu write-through backend
 * (huduSource.ts). CredentialSummary is a metadata-only projection: it can
 * never carry value-bearing fields. Plaintext values exist only (a) in the
 * write path between request and encryption, and (b) in a reveal response —
 * never in lists, caches, or logs.
 */

export type CredentialSourceKind = 'alga' | 'hudu';

/** Metadata-only projection; never carries value-bearing fields. */
export interface CredentialSummary {
  /** Native uuid, or `hudu:{company_id}:{password_id}`. */
  id: string;
  source: CredentialSourceKind;
  /** Alga client_id (Hudu rows resolved via the company mapping). */
  clientId: string;
  /** Display-only join; never part of the storage contract. */
  clientName?: string | null;
  name: string;
  username: string | null;
  url: string | null;
  description: string | null;
  hasOtp: boolean;
  /** Always false for hudu rows. */
  isRestricted: boolean;
  /** Hudu display metadata only in v1. */
  folderName: string | null;
  /** Open-in-Hudu deep link. */
  externalUrl: string | null;
  /** Native only in v1. */
  attachedAssetIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export type CredentialRevealState = 'ok' | 'no_access' | 'not_found' | 'error';

export interface CredentialRevealResult {
  state: CredentialRevealState;
  /** Transient; never persisted or logged. */
  password?: string;
  otpCode?: { code: string; secondsRemaining: number } | null;
  error?: string;
  errorKind?: string;
}

export interface CredentialWriteInput {
  clientId: string;
  name: string;
  username?: string | null;
  /** Value-bearing; write-only. */
  password?: string | null;
  /** Value-bearing; write-only. */
  otpSecret?: string | null;
  url?: string | null;
  description?: string | null;
  /** Native only in v1. */
  assetIds?: string[];
}

export interface CredentialListFilter {
  clientId?: string;
  assetId?: string;
  search?: string;
  /**
   * Backend selection for aggregation. Undefined or empty means "all" (the
   * historical behavior); a non-empty whitelist restricts which backends the
   * credentialActions aggregation invokes. Consumed only by the aggregation —
   * the native/hudu `list` implementations ignore this field.
   */
  sources?: CredentialSourceKind[];
}

export interface CredentialGrant {
  subjectType: 'user' | 'team';
  subjectId: string;
}

/** Context passed from the server actions into each CredentialSource. */
export interface CredentialSourceContext {
  tenant: string;
  userId: string;
  user: import('@alga-psa/types').IUserWithRoles;
}

/** Metadata about a credential (native rows only) for edit/restrict surfaces. */
export interface CredentialDetail extends CredentialSummary {
  grants: CredentialGrant[];
}

export interface CredentialSource {
  kind: CredentialSourceKind;
  list(ctx: { tenant: string; userId: string }, filter: CredentialListFilter): Promise<CredentialSummary[]>;
  reveal(ctx: { tenant: string; userId: string }, id: string): Promise<CredentialRevealResult>;
  revealOtpSeed(ctx: { tenant: string; userId: string }, id: string): Promise<CredentialRevealResult>;
  create(ctx: { tenant: string; userId: string }, input: CredentialWriteInput): Promise<CredentialSummary>;
  update(ctx: { tenant: string; userId: string }, id: string, input: Partial<CredentialWriteInput>): Promise<CredentialSummary>;
  remove(ctx: { tenant: string; userId: string }, id: string): Promise<void>;
}
