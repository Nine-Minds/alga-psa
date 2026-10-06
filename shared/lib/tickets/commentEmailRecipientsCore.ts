/**
 * Pure half of the per-comment Cc/Bcc helpers: validation, normalization and
 * reading the stored metadata. No database import, so client components can
 * render the Cc/Bcc lines without pulling server-only code into the bundle.
 * The tenant-scoped lookups live in `./commentEmailRecipients`.
 */
import { z } from 'zod';
import type { CommentEmailRecipient, CommentEmailRecipients } from '@alga-psa/types';

/** Abuse ceiling: at most this many cc + bcc recipients on one comment. */
export const MAX_COMMENT_EMAIL_RECIPIENTS = 20;

const emailSchema = z.string().email();

/**
 * Thrown when a caller supplies cc/bcc that cannot be accepted. Entry points
 * map `field` onto their own error shape (a 400 with field details for REST, a
 * plain action error for the server actions).
 */
export class CommentEmailRecipientsError extends Error {
  readonly field: 'cc' | 'bcc' | 'is_internal';
  readonly value?: string;

  constructor(message: string, field: 'cc' | 'bcc' | 'is_internal', value?: string) {
    super(message);
    this.name = 'CommentEmailRecipientsError';
    this.field = field;
    this.value = value;
  }
}

export interface NormalizeCommentEmailRecipientsInput {
  cc?: readonly string[] | null;
  bcc?: readonly string[] | null;
  isInternal?: boolean;
}

/** One-off Cc/Bcc a caller supplies for a single public comment. */
export type CommentEmailRecipientsInput = { cc?: string[]; bcc?: string[] };

function toInputList(value: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

/**
 * Trims, validates and dedupes a comment's one-off cc/bcc lists.
 *
 * Comparison is case-insensitive while the first display casing is kept. An
 * address listed in both lists stays in cc only. Returns `null` when there is
 * nothing to store so callers never write an empty `email_recipients` key.
 */
export function normalizeCommentEmailRecipients(
  input: NormalizeCommentEmailRecipientsInput
): CommentEmailRecipients | null {
  const cc = toInputList(input.cc);
  const bcc = toInputList(input.bcc);

  if (cc.length === 0 && bcc.length === 0) {
    return null;
  }

  if (input.isInternal) {
    throw new CommentEmailRecipientsError(
      'Cc/Bcc recipients cannot be added to an internal note',
      'is_internal'
    );
  }

  if (cc.length + bcc.length > MAX_COMMENT_EMAIL_RECIPIENTS) {
    throw new CommentEmailRecipientsError(
      `At most ${MAX_COMMENT_EMAIL_RECIPIENTS} Cc and Bcc recipients are allowed on one comment`,
      cc.length > 0 ? 'cc' : 'bcc'
    );
  }

  const seen = new Set<string>();
  const collect = (values: string[], field: 'cc' | 'bcc'): CommentEmailRecipient[] => {
    const result: CommentEmailRecipient[] = [];
    for (const value of values) {
      if (!emailSchema.safeParse(value).success) {
        throw new CommentEmailRecipientsError(
          `"${value}" is not a valid email address`,
          field,
          value
        );
      }
      const key = value.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ email: value });
    }
    return result;
  };

  // cc is collected first so an address in both lists survives as cc only.
  const normalizedCc = collect(cc, 'cc');
  const normalizedBcc = collect(bcc, 'bcc');

  if (normalizedCc.length === 0 && normalizedBcc.length === 0) {
    return null;
  }

  return { cc: normalizedCc, bcc: normalizedBcc };
}

function parseMetadata(metadata: unknown): Record<string, unknown> | null {
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : null;
}

/** Reads `metadata.email_recipients` off a comment row, tolerating jsonb strings. */
export function readCommentEmailRecipients(metadata: unknown): CommentEmailRecipients | null {
  const parsed = parseMetadata(metadata);
  const raw = parsed?.email_recipients;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const source = raw as { cc?: unknown; bcc?: unknown };
  const coerce = (value: unknown): CommentEmailRecipient[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .filter((entry): entry is CommentEmailRecipient =>
        Boolean(entry) && typeof entry === 'object' && typeof (entry as any).email === 'string'
      )
      .map((entry) => ({
        email: entry.email,
        ...(entry.name ? { name: entry.name } : {}),
        ...(entry.contact_id ? { contact_id: entry.contact_id } : {}),
        ...(entry.user_id ? { user_id: entry.user_id } : {}),
      }));
  };
  const cc = coerce(source.cc);
  const bcc = coerce(source.bcc);
  if (cc.length === 0 && bcc.length === 0) {
    return null;
  }
  return { cc, bcc };
}


/**
 * Removes `email_recipients.bcc` from a comment's metadata. Client-portal
 * payloads run through this: Bcc is MSP-only and must never leave the server
 * on a client-facing response. Returns the metadata unchanged when there is
 * nothing to strip.
 */
export function stripCommentBccFromMetadata<T>(metadata: T): T {
  const parsed = parseMetadata(metadata);
  const raw = parsed?.email_recipients;
  if (!raw || typeof raw !== 'object') {
    return metadata;
  }
  const { bcc, ...rest } = raw as Record<string, unknown>;
  if (bcc === undefined) {
    return metadata;
  }
  // The caller may have handed us a jsonb string; always return an object so
  // the stripped shape can't be re-serialised from the original text.
  return { ...parsed, email_recipients: { ...rest, bcc: [] } } as unknown as T;
}
