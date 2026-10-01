/**
 * Board "Default watchlist" document: types, strict write-side validation and
 * lenient read (alga-2026-0002379). Pure — no database access — so the board
 * settings UI can share the exact validation the server action enforces.
 * Resolution and the ticket-side merge live in ./boardDefaultWatchlist.ts.
 *
 * Storage: `boards.default_watchlist_enabled` (opt-in switch) and
 * `boards.default_watchlist` (jsonb `{ user_ids, emails }`). Internal users are
 * stored by id and resolved to an address at ticket creation; free-form
 * addresses are stored normalised (trimmed, lower-cased, de-duplicated).
 */
import { z } from 'zod';

export const BOARD_DEFAULT_WATCHLIST_SOURCE = 'board_default';

/** Upper bound per board; a default watchlist is a handful of people, not a mailing list. */
export const BOARD_DEFAULT_WATCHLIST_MAX_RECIPIENTS = 50;

export interface BoardDefaultWatchlist {
  user_ids: string[];
  emails: string[];
}

export const EMPTY_BOARD_DEFAULT_WATCHLIST: BoardDefaultWatchlist = { user_ids: [], emails: [] };

const emailSchema = z.string().email();

/** Strict validation for an address typed into the settings UI or sent to the action. */
export function normalizeWatchlistEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !emailSchema.safeParse(trimmed).success) return null;
  return trimmed.toLowerCase();
}

export class BoardDefaultWatchlistValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_EMAIL' | 'INVALID_USER_ID' | 'TOO_MANY' | 'INVALID_SHAPE',
    public readonly invalidValues: string[] = []
  ) {
    super(message);
    this.name = 'BoardDefaultWatchlistValidationError';
  }
}

/**
 * Validate and normalise a watchlist document supplied by a caller (the write
 * path). Rejects rather than drops bad entries so the UI can show which address
 * was refused; de-duplicates case-insensitively.
 */
export function parseBoardDefaultWatchlistInput(raw: unknown): BoardDefaultWatchlist {
  if (raw === null || raw === undefined) return { user_ids: [], emails: [] };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BoardDefaultWatchlistValidationError('Default watchlist must be an object', 'INVALID_SHAPE');
  }

  const record = raw as Record<string, unknown>;
  const rawUserIds = record.user_ids ?? [];
  const rawEmails = record.emails ?? [];
  if (!Array.isArray(rawUserIds) || !Array.isArray(rawEmails)) {
    throw new BoardDefaultWatchlistValidationError('Default watchlist user_ids and emails must be arrays', 'INVALID_SHAPE');
  }

  const invalidUserIds = rawUserIds.filter((id) => !z.string().uuid().safeParse(id).success).map(String);
  if (invalidUserIds.length > 0) {
    throw new BoardDefaultWatchlistValidationError('Default watchlist contains an invalid user', 'INVALID_USER_ID', invalidUserIds);
  }

  const invalidEmails: string[] = [];
  const emails = new Set<string>();
  for (const value of rawEmails) {
    const normalized = normalizeWatchlistEmail(value);
    if (!normalized) {
      invalidEmails.push(String(value));
      continue;
    }
    emails.add(normalized);
  }
  if (invalidEmails.length > 0) {
    throw new BoardDefaultWatchlistValidationError(
      `Invalid email address: ${invalidEmails.join(', ')}`,
      'INVALID_EMAIL',
      invalidEmails
    );
  }

  const userIds = Array.from(new Set(rawUserIds.map((id) => String(id).toLowerCase())));
  if (userIds.length + emails.size > BOARD_DEFAULT_WATCHLIST_MAX_RECIPIENTS) {
    throw new BoardDefaultWatchlistValidationError(
      `A default watchlist can hold at most ${BOARD_DEFAULT_WATCHLIST_MAX_RECIPIENTS} recipients`,
      'TOO_MANY'
    );
  }

  return { user_ids: userIds, emails: Array.from(emails) };
}

/**
 * Lenient read of a stored document (jsonb may arrive parsed or as text). Bad
 * entries are dropped, never thrown on: ticket creation must not fail because
 * of a malformed board setting.
 */
export function readBoardDefaultWatchlist(raw: unknown): BoardDefaultWatchlist {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { user_ids: [], emails: [] };
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { user_ids: [], emails: [] };

  const record = value as Record<string, unknown>;
  const userIds = Array.isArray(record.user_ids)
    ? record.user_ids.filter((id): id is string => typeof id === 'string' && z.string().uuid().safeParse(id).success)
    : [];
  const emails = Array.isArray(record.emails)
    ? record.emails.map(normalizeWatchlistEmail).filter((email): email is string => !!email)
    : [];

  return { user_ids: Array.from(new Set(userIds)), emails: Array.from(new Set(emails)) };
}
