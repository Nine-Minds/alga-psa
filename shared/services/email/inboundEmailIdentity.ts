/**
 * Single shared inbound-message identity normalization and deterministic key
 * derivation for the durable inbound email pipeline.
 *
 * The authoritative idempotency identity is `(tenant, provider_id,
 * normalized_message_id)`. Every producer, stager, core processor, backfill and
 * reconciliation path must derive identities through `normalizeInboundMessageIdentity`
 * — it MUST never be derived from a queue job ID.
 */

import { createHash } from 'node:crypto';

export type InboundProviderType = 'microsoft' | 'google' | 'imap';

export type InboundIdentityScheme = 'rfc822' | 'provider' | 'imap';

export interface NormalizedInboundIdentity {
  /**
   * Canonical durable identity stored in `inbound_email_inbox.normalized_message_id`.
   * Examples: `rfc822:abc@example.com`, `provider:microsoft:AAk...`, `imap:INBOX:12345:678`.
   */
  normalized: string;
  scheme: InboundIdentityScheme;
  /** Original RFC 5322 Message-ID (without angle brackets), if one was present. */
  rfcMessageId: string | null;
  /** Provider-native stable ID (e.g. Graph message id, Gmail history message id). */
  providerMessageId: string | null;
}

export interface InboundIdentityInput {
  providerType: InboundProviderType;
  /**
   * Raw RFC 5322 Message-ID header value, e.g. `<abc.123@example.com>`. May
   * include surrounding angle brackets or whitespace.
   */
  rfcMessageId?: string | null;
  /** Provider-native stable message id (preferred for provider form). */
  providerMessageId?: string | null;
  /** IMAP-only durable coordinates. */
  mailbox?: string | null;
  uidValidity?: string | null;
  uid?: string | number | null;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Trim whitespace, remove exactly one surrounding pair of angle brackets,
 * preserve the local part case, lowercase only the domain, and validate the
 * result is non-empty. Returns null for empty / bracket-only values.
 *
 * This is the single canonical RFC 5322 Message-ID normalizer for the inbound
 * pipeline. Every place a Message-ID lookup key or a stored `email_metadata`
 * key is derived must go through this function (never a third variant).
 *
 * Idempotency: an already-canonical `rfc822:<id>` value (for example a stored
 * `inbound_email_inbox.normalized_message_id` or a mirror-written legacy audit
 * `message_id`) is unwrapped before normalizing, so feeding a normalized value
 * back in NEVER produces a double-prefixed `rfc822:rfc822:<id>` key. All
 * leading `rfc822:` prefixes are stripped (a corrupted double-prefixed value
 * heals to the bare RFC id).
 */
export function normalizeRfc822MessageId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;
  // Remove exactly one surrounding pair of angle brackets.
  if (value.startsWith('<') && value.endsWith('>') && value.length > 2) {
    value = value.slice(1, -1).trim();
  }
  if (!value) return null;
  // Unwrap every already-applied canonical `rfc822:` prefix (this runs after
  // bracket removal so a bracketed prefixed value like `<rfc822:abc@x>` also
  // heals), making normalization idempotent for canonical inputs.
  while (value.startsWith('rfc822:')) {
    value = value.slice('rfc822:'.length).trim();
  }
  if (!value) return null;
  const atIndex = value.indexOf('@');
  if (atIndex <= 0) return value;
  const local = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1).toLowerCase();
  return `${local}@${domain}`;
}

/**
 * Parse a string that already carries a canonical `scheme:`-prefixed inbound
 * identity (`rfc822:<id>`, `provider:<type>:<opaque>`, or `imap:<mailbox>:
 * <uidvalidity>:<uid>`). Returns null when the value is not an already-canonical
 * identity. Used to make `normalizeInboundMessageIdentity` idempotent: a stored
 * normalized key fed back into any field is preserved scheme-for-scheme instead
 * of being re-wrapped into a double-prefixed key.
 */
export function parseCanonicalInboundIdentity(
  value: string | null | undefined
): { scheme: InboundIdentityScheme; normalized: string; rfcMessageId: string | null; providerMessageId: string | null } | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('rfc822:')) {
    const bare = normalizeRfc822MessageId(trimmed.slice('rfc822:'.length));
    if (!bare) return null;
    return { scheme: 'rfc822', normalized: `rfc822:${bare}`, rfcMessageId: bare, providerMessageId: null };
  }

  if (trimmed.startsWith('provider:')) {
    const rest = trimmed.slice('provider:'.length);
    const sep = rest.indexOf(':');
    if (sep <= 0 || sep === rest.length - 1) return null;
    const providerType = rest.slice(0, sep);
    const opaqueId = rest.slice(sep + 1);
    if (!providerType || !opaqueId) return null;
    return { scheme: 'provider', normalized: `provider:${providerType}:${opaqueId}`, rfcMessageId: null, providerMessageId: opaqueId };
  }

  if (trimmed.startsWith('imap:')) {
    const parts = trimmed.slice('imap:'.length).split(':');
    const [mailbox, uidValidity, uid] = parts;
    if (!mailbox || !uidValidity || !uid) return null;
    return { scheme: 'imap', normalized: `imap:${mailbox}:${uidValidity}:${uid}`, rfcMessageId: null, providerMessageId: null };
  }

  return null;
}

function isUsableProviderId(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0;
}

function isUsableImapIdentity(input: InboundIdentityInput): boolean {
  return (
    isUsableProviderId(input.mailbox) &&
    isUsableProviderId(input.uidValidity) &&
    input.uid !== undefined &&
    input.uid !== null &&
    String(input.uid).trim().length > 0
  );
}

/**
 * Normalize the inbound message identity following the plan's rules:
 *
 *  1. Prefer the RFC 5322 Message-ID -> `rfc822:<local>@<lowercase-domain>`.
 *  2. Otherwise use a provider-native stable id -> `provider:<provider_type>:<opaque-id>`
 *     (opaque ids are trimmed but NOT lowercased).
 *  3. For IMAP without either, use `imap:<mailbox>:<uidvalidity>:<uid>`. A UID
 *     without UIDVALIDITY is not a durable identity.
 *
 * Returns `null` when no durable identity can be derived (callers must decide
 * retryability/terminality from source availability rather than substituting a
 * random value).
 *
 * Idempotency: an input that is already a canonical `scheme:`-prefixed identity
 * (`rfc822:`, `provider:<type>:`, or `imap:`) is preserved as-is — the original
 * scheme is kept and never re-wrapped. This protects every round-trip path
 * (staging, recovery/backfill, replay, mirror) that feeds a stored normalized
 * key back into a raw-identity field: it can never produce a double-prefixed
 * `rfc822:rfc822:…` key that misses the canonical inbox row.
 */
export function normalizeInboundMessageIdentity(
  input: InboundIdentityInput
): NormalizedInboundIdentity | null {
  // An already-canonical identity in the RFC field keeps its own scheme.
  const canonicalRfc = parseCanonicalInboundIdentity(input.rfcMessageId);
  if (canonicalRfc) {
    return {
      scheme: canonicalRfc.scheme,
      normalized: canonicalRfc.normalized,
      rfcMessageId: canonicalRfc.rfcMessageId,
      providerMessageId: canonicalRfc.providerMessageId,
    };
  }

  const rfcMessageId = normalizeRfc822MessageId(input.rfcMessageId);
  if (rfcMessageId) {
    return {
      normalized: `rfc822:${rfcMessageId}`,
      scheme: 'rfc822',
      rfcMessageId,
      providerMessageId: null,
    };
  }

  // An already-canonical identity in the provider field keeps its own scheme.
  const canonicalProvider = parseCanonicalInboundIdentity(input.providerMessageId);
  if (canonicalProvider) {
    return {
      scheme: canonicalProvider.scheme,
      normalized: canonicalProvider.normalized,
      rfcMessageId: canonicalProvider.rfcMessageId,
      providerMessageId: canonicalProvider.providerMessageId,
    };
  }

  const providerMessageId =
    typeof input.providerMessageId === 'string' ? input.providerMessageId.trim() : '';
  if (providerMessageId) {
    return {
      normalized: `provider:${input.providerType}:${providerMessageId}`,
      scheme: 'provider',
      rfcMessageId: null,
      providerMessageId,
    };
  }

  if (input.providerType === 'imap' && isUsableImapIdentity(input)) {
    const mailbox = String(input.mailbox).trim();
    const uidValidity = String(input.uidValidity).trim();
    const uid = String(input.uid).trim();
    return {
      normalized: `imap:${mailbox}:${uidValidity}:${uid}`,
      scheme: 'imap',
      rfcMessageId: null,
      providerMessageId: null,
    };
  }

  return null;
}

/**
 * Deterministic ingress key for a provider notification/poll pointer.
 * Examples: `message:<graph-message-id>`, `history:<history-id>:<pubsub-message-id>`,
 * `mailbox:<mailbox>:uidvalidity:<value>:uid:<uid>`.
 */
export function buildIngressKey(params: {
  providerType: InboundProviderType;
  providerMessageId?: string | null;
  historyId?: string | null;
  pubsubMessageId?: string | null;
  mailbox?: string | null;
  uidValidity?: string | null;
  uid?: string | number | null;
}): string | null {
  if (params.providerType === 'microsoft' && isUsableProviderId(params.providerMessageId)) {
    return `message:${String(params.providerMessageId).trim()}`;
  }
  if (params.providerType === 'google') {
    const historyId = typeof params.historyId === 'string' ? params.historyId.trim() : '';
    if (historyId) {
      const pubsub = isUsableProviderId(params.pubsubMessageId)
        ? `:${String(params.pubsubMessageId).trim()}`
        : '';
      return `history:${historyId}${pubsub}`;
    }
  }
  if (params.providerType === 'imap' && isUsableImapIdentity(params)) {
    return `mailbox:${String(params.mailbox).trim()}:uidvalidity:${String(params.uidValidity).trim()}:uid:${String(params.uid).trim()}`;
  }
  return null;
}

/**
 * Deterministic object-storage key for a staged raw MIME source:
 * `inbound-email/<tenant>/<provider-id>/<sha256(normalized-id)>/<source-sha256>.eml`.
 * Message identifiers and subjects are never exposed in keys.
 */
export function buildInboundSourceObjectKey(params: {
  tenant: string;
  providerId: string;
  normalizedMessageId: string;
  sourceSha256: string;
}): string {
  const identityHash = sha256(params.normalizedMessageId);
  return `inbound-email/${params.tenant}/${params.providerId}/${identityHash}/${params.sourceSha256}.eml`;
}

/**
 * Deterministic artifact key: `<artifact-type>:<stable-attachment-id-or-content-digest>`.
 */
export function buildArtifactKey(params: {
  artifactType: 'attachment' | 'embedded_image' | 'original_email';
  stableId: string;
}): string {
  return `${params.artifactType}:${params.stableId}`;
}

/**
 * Deterministic storage key for a persisted artifact:
 * `inbound-artifacts/<tenant>/<inbox-id>/<sha256(artifact-key)>/<content-digest>`.
 * Digest is truncated to 32 hex chars to bound key length.
 */
export function buildArtifactStorageKey(params: {
  tenant: string;
  inboxId: string;
  artifactKey: string;
  contentDigest?: string | null;
  fileName: string;
}): string {
  const digest = params.contentDigest ? sha256(params.contentDigest).slice(0, 32) : 'nodigest';
  const safeName = sanitizeKeySegment(params.fileName) || 'artifact.bin';
  return `inbound-artifacts/${params.tenant}/${params.inboxId}/${sha256(params.artifactKey).slice(0, 32)}/${digest}/${safeName}`;
}

/**
 * Deterministic outbox event key for a semantic event caused by the core
 * transaction. Stable so `(tenant, inbox_id, event_key)` prevents replay
 * duplicates.
 */
export function buildOutboxEventKey(params: {
  eventKind: 'ticket-created' | 'ticket-assigned' | 'initial-comment-created' | 'reply-comment-created' | string;
  extra?: string;
}): string {
  return params.extra ? `${params.eventKind}:${params.extra}` : params.eventKind;
}

function sanitizeKeySegment(input: string): string {
  return String(input)
    .replace(/[/\\]/g, '-')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

export function sha256Hex(input: string): string {
  return sha256(input);
}
