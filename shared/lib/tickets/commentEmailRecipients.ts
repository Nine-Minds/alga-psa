import type { Knex } from 'knex';
import { z } from 'zod';
import { tenantDb } from '@alga-psa/db';
import type { CommentEmailRecipient, CommentEmailRecipients } from '@alga-psa/types';

type Connection = Knex | Knex.Transaction;

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

/**
 * Fills in `name` / `contact_id` / `user_id` for addresses that belong to a
 * contact (primary or additional email) or an internal user in this tenant.
 * Unknown addresses stay email-only. Every lookup is tenant-scoped.
 */
export async function resolveCommentEmailRecipientIdentities(
  conn: Connection,
  tenant: string,
  recipients: CommentEmailRecipients
): Promise<CommentEmailRecipients> {
  const all = [...recipients.cc, ...recipients.bcc];
  const emails = Array.from(new Set(all.map((entry) => entry.email.toLowerCase())));
  if (emails.length === 0) {
    return recipients;
  }

  const db = tenantDb(conn, tenant);

  const additional = await db.table('contact_additional_email_addresses')
    .select('contact_name_id', 'normalized_email_address')
    .whereIn('normalized_email_address', emails);

  const contactIds = Array.from(
    new Set(additional.map((row: any) => row.contact_name_id).filter(Boolean))
  );

  const emailPlaceholders = emails.map(() => '?').join(', ');
  const contactQuery = db.table('contacts')
    .select('contact_name_id', 'full_name', 'email')
    .where(function (this: Knex.QueryBuilder) {
      this.whereRaw(`lower(contacts.email) in (${emailPlaceholders})`, emails);
      if (contactIds.length > 0) {
        this.orWhereIn('contact_name_id', contactIds);
      }
    });
  const contacts = await contactQuery;

  const byEmail = new Map<string, CommentEmailRecipient>();
  const contactById = new Map<string, any>();
  for (const contact of contacts as any[]) {
    contactById.set(contact.contact_name_id, contact);
    const primary = typeof contact.email === 'string' ? contact.email.toLowerCase() : '';
    if (primary && emails.includes(primary) && !byEmail.has(primary)) {
      byEmail.set(primary, {
        email: primary,
        ...(contact.full_name ? { name: String(contact.full_name) } : {}),
        contact_id: contact.contact_name_id,
      });
    }
  }
  for (const row of additional as any[]) {
    const key = String(row.normalized_email_address || '').toLowerCase();
    const contact = contactById.get(row.contact_name_id);
    if (!key || !contact || byEmail.has(key)) {
      continue;
    }
    byEmail.set(key, {
      email: key,
      ...(contact.full_name ? { name: String(contact.full_name) } : {}),
      contact_id: contact.contact_name_id,
    });
  }

  const unresolved = emails.filter((email) => !byEmail.has(email));
  if (unresolved.length > 0) {
    const users = await db.table('users')
      .select('user_id', 'first_name', 'last_name', 'email')
      .where({ user_type: 'internal' })
      .whereRaw(`lower(users.email) in (${unresolved.map(() => '?').join(', ')})`, unresolved);

    for (const user of users as any[]) {
      const key = typeof user.email === 'string' ? user.email.toLowerCase() : '';
      if (!key || byEmail.has(key)) {
        continue;
      }
      const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
      byEmail.set(key, {
        email: key,
        ...(name ? { name } : {}),
        user_id: user.user_id,
      });
    }
  }

  const decorate = (list: CommentEmailRecipient[]): CommentEmailRecipient[] =>
    list.map((entry) => {
      const resolved = byEmail.get(entry.email.toLowerCase());
      if (!resolved) {
        return entry;
      }
      // Keep the caller's display casing for the address itself.
      return {
        ...entry,
        ...(resolved.name ? { name: resolved.name } : {}),
        ...(resolved.contact_id ? { contact_id: resolved.contact_id } : {}),
        ...(resolved.user_id ? { user_id: resolved.user_id } : {}),
      };
    });

  return { cc: decorate(recipients.cc), bcc: decorate(recipients.bcc) };
}

/**
 * The single entry point every comment-creation path uses: validate, then
 * resolve identities. Returns `null` when there is nothing to persist.
 */
export async function prepareCommentEmailRecipients(
  conn: Connection,
  tenant: string,
  input: NormalizeCommentEmailRecipientsInput
): Promise<CommentEmailRecipients | null> {
  const normalized = normalizeCommentEmailRecipients(input);
  if (!normalized) {
    return null;
  }
  return resolveCommentEmailRecipientIdentities(conn, tenant, normalized);
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
 * The lower-cased union of every one-off cc/bcc address ever used on a ticket's
 * comments. Inbound replies consult this so a Cc'd person is accepted without
 * becoming a watcher. Tenant- and ticket-scoped.
 */
export async function getTicketOneOffRecipients(
  conn: Connection,
  tenant: string,
  ticketId: string
): Promise<Set<string>> {
  const result = new Set<string>();
  if (!tenant || !ticketId) {
    return result;
  }

  const rows = await tenantDb(conn, tenant).table('comments')
    .select('metadata')
    .where({ ticket_id: ticketId })
    .whereRaw("metadata -> 'email_recipients' IS NOT NULL");

  for (const row of rows as any[]) {
    const recipients = readCommentEmailRecipients(row.metadata);
    if (!recipients) {
      continue;
    }
    for (const entry of [...recipients.cc, ...recipients.bcc]) {
      const normalized = entry.email.trim().toLowerCase();
      if (normalized) {
        result.add(normalized);
      }
    }
  }

  return result;
}
