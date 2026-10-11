import type {
  ITicketLatestActivityActor,
  TicketLatestActivityActorKind,
} from '@alga-psa/types';

/** The ticket-row fields the actor resolution needs. */
export interface LatestActivityTicketRow {
  latest_activity_at?: string | null;
  updated_at?: string | null;
  entered_at?: string | null;
  updated_by?: string | null;
  entered_by?: string | null;
  entered_by_name?: string | null;
}

/** Newest published comment of a ticket, as loaded by the list enrichment. */
export interface LatestActivityComment {
  created_at: string | Date;
  user_id?: string | null;
  contact_id?: string | null;
  is_system_generated?: boolean | null;
  /** `comments.metadata->'email'` (sender of an unmatched inbound email). */
  email?: unknown;
}

export interface LatestActivityNames {
  users: Record<string, { name: string; userType?: string | null }>;
  contacts: Record<string, string>;
}

/** An update within this window of creation is part of creating the ticket. */
const CREATION_WINDOW_MS = 1000;

function toMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// LEVERAGE: pattern comment-author-label — mirrors CommentItem.getInboundSenderIdentity/getAuthorName; the author-label rules now exist in two places.
function getInboundSenderName(email: unknown): string | null {
  if (!email || typeof email !== 'object' || Array.isArray(email)) return null;
  const record = email as Record<string, unknown>;
  const from =
    record.from && typeof record.from === 'object' && !Array.isArray(record.from)
      ? (record.from as Record<string, unknown>)
      : null;

  const fromNameRaw =
    typeof record.fromName === 'string'
      ? record.fromName
      : typeof from?.name === 'string'
        ? from.name
        : '';
  const fromName = fromNameRaw.trim();
  if (fromName) return fromName;

  const fromAddressRaw =
    typeof record.fromAddress === 'string'
      ? record.fromAddress
      : typeof from?.email === 'string'
        ? from.email
        : '';
  return fromAddressRaw.trim() || null;
}

function userActor(
  userId: string,
  names: LatestActivityNames,
  fallbackName?: string | null
): ITicketLatestActivityActor | null {
  const known = names.users[userId];
  const name = known?.name?.trim() || fallbackName?.trim() || null;
  if (!name) return null;
  const kind: TicketLatestActivityActorKind = known?.userType === 'client' ? 'client_user' : 'user';
  return { kind, name };
}

/**
 * Who produced the activity that `latest_activity_at` reports.
 *
 * `latest_activity_at` is GREATEST(updated_at, entered_at, newest published
 * comment). The comment wins ties, then a ticket edit, then creation.
 * Returns null when no one can be named; never invents a "System" actor for a
 * NULL `updated_by`.
 */
export function resolveLatestActivityActor(
  row: LatestActivityTicketRow,
  latestComment: LatestActivityComment | null | undefined,
  names: LatestActivityNames
): ITicketLatestActivityActor | null {
  const latestMs = toMs(row.latest_activity_at);
  if (latestMs === null) return null;

  const commentMs = toMs(latestComment?.created_at);
  if (latestComment && commentMs !== null && commentMs >= latestMs) {
    if (latestComment.is_system_generated) {
      return { kind: 'system', name: null };
    }
    if (latestComment.user_id) {
      return userActor(latestComment.user_id, names);
    }
    if (latestComment.contact_id) {
      const name = names.contacts[latestComment.contact_id]?.trim();
      return name ? { kind: 'contact', name } : null;
    }
    const senderName = getInboundSenderName(latestComment.email);
    return senderName ? { kind: 'email_sender', name: senderName } : null;
  }

  const updatedMs = toMs(row.updated_at);
  const enteredMs = toMs(row.entered_at);
  if (updatedMs !== null && (enteredMs === null || updatedMs - enteredMs > CREATION_WINDOW_MS)) {
    return row.updated_by ? userActor(row.updated_by, names) : null;
  }

  // Creation won.
  if (!row.entered_by) return null;
  const enteredByName = row.entered_by_name && row.entered_by_name !== 'Unknown' ? row.entered_by_name : null;
  return userActor(row.entered_by, names, enteredByName);
}
