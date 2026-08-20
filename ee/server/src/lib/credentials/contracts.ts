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

/**
 * Entity roster for credential associations, mirroring document_associations
 * plus `document`. `client` sits in the constraint for parity with documents;
 * no UI writes it in this card (the client Passwords tab stays
 * ownership-driven). Client-bound types are `ticket`, `asset`, `contact`,
 * `contract`, `project_task`, `quote`; the rest attach unconstrained.
 */
export type CredentialAssociationEntityType =
  | 'asset'
  | 'client'
  | 'contact'
  | 'contract'
  | 'document'
  | 'project_task'
  | 'quote'
  | 'team'
  | 'tenant'
  | 'ticket'
  | 'user';

export interface CredentialAttachment {
  entityType: CredentialAssociationEntityType;
  entityId: string;
}

/**
 * Caller-seen visible baseline for a replacement save (entity-scoped).
 *
 * The entity-list resolution that rendered the caller's snapshot yields, for
 * every Hudu row the caller actually SAW, the association-row identity
 * (`association_id`) that row was rendered from. A full-set replacement
 * (`setEntityCredentials`) submits the desired credential set together with
 * this baseline so a Hudu ref is detached only when the caller demonstrably
 * saw THIS exact association row and then omitted it:
 *
 *  - a ref that was hidden at list load (inactive integration, transport/API
 *    failure, permission hiccup, attached after the snapshot) is absent from
 *    the baseline and can never be detached by the replacement — fail-closed
 *    even if it would resolve visible at save time;
 *  - the delete is keyed to the baseline's exact association row identity
 *    inside the transaction, so a row reattached under the same ref string
 *    (fresh `association_id`) after the snapshot is never removed.
 */
export interface CredentialReplaceBaseline {
  /** Hudu ref (`hudu:{company_id}:{password_id}`) the caller saw in the list. */
  ref: string;
  /** The `credential_associations.association_id` the ref was rendered from. */
  associationId: string;
}

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
  /** Entity attachments (both sources); metadata only. */
  attachments: CredentialAttachment[];
  /**
   * Entity-scoped lists only: the `credential_associations.association_id` the
   * visible row was rendered from, so the UI's rendered snapshot can be echoed
   * back as the replacement-save baseline. Absent on non-entity-scoped rows.
   */
  associationId?: string;
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
  /** Entity attachments to create with the credential (native side persists
   *  them; Hudu-side creates are associated by ref after the Hudu write). */
  attachments?: CredentialAttachment[];
}

export interface CredentialListFilter {
  clientId?: string;
  /**
   * Entity-scoped lists: filter to credentials associated with one entity.
   * Both `entityType` and `entityId` must be set together.
   */
  entityType?: CredentialAssociationEntityType;
  entityId?: string;
  search?: string;
  /**
   * Backend selection for aggregation. Undefined or empty means "all" (the
   * historical behavior); a non-empty whitelist restricts which backends the
   * credentialActions aggregation invokes. Consumed only by the aggregation —
   * the native/hudu `list` implementations ignore this field. For
   * association-driven entity lists the whitelist composes uniformly: a
   * deselected backend's rows (including its association rows) are omitted
   * for that response but never pruned.
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
