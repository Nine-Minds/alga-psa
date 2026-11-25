/**
 * Client Portal Notices: pure domain library (types, validation, display logic).
 *
 * Side-effect free: no DB, no React, no I/O, no clock. Safe to import from
 * server actions and client components alike. Everything is plain text; nothing
 * here produces HTML.
 */
import { isSupportedLocale, normalizeLocale } from '@alga-psa/core/i18n/config';
import type { SupportedLocale } from '@alga-psa/core/i18n/config';

// ---------------------------------------------------------------------------
// Types and constants (F005)
// ---------------------------------------------------------------------------

export const NOTICE_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type NoticeSeverity = (typeof NOTICE_SEVERITIES)[number];

export const NOTICE_AUDIENCE_TYPES = ['all', 'clients', 'tags'] as const;
export type NoticeAudienceType = (typeof NOTICE_AUDIENCE_TYPES)[number];

export const NOTICE_STATUSES = ['live', 'scheduled', 'expired'] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

export const NOTICE_MESSAGE_MAX_LENGTH = 500;
export const NOTICE_LINK_LABEL_MAX_LENGTH = 60;
export const NOTICE_LINK_URL_MAX_LENGTH = 2048;

export const NOTICE_DEFAULT_LOCALE_KEY = 'default' as const;

export interface NoticeLocaleContent {
  message: string;
  linkLabel?: string | null;
}

/** locale -> content; the `default` key is required. Mirrors the `content` jsonb column. */
export type NoticeContent = {
  [NOTICE_DEFAULT_LOCALE_KEY]: NoticeLocaleContent;
} & { [locale: string]: NoticeLocaleContent | undefined };

export type NoticeTimestamp = Date | string | null | undefined;

export interface ClientPortalNoticeInput {
  severity: NoticeSeverity;
  content: NoticeContent;
  link_url?: string | null;
  starts_at?: NoticeTimestamp;
  ends_at?: NoticeTimestamp;
  dismissible: boolean;
  audience_type: NoticeAudienceType;
  /** Used when audience_type === 'clients'. */
  audience_client_ids?: string[];
  /** Used when audience_type === 'tags'. */
  audience_tag_ids?: string[];
}

export interface ClientPortalNotice extends ClientPortalNoticeInput {
  tenant: string;
  notice_id: string;
  created_by?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

// ---------------------------------------------------------------------------
// Link URL allowlist (F007)
// ---------------------------------------------------------------------------

// Any whitespace, C0/C1 control or invisible/format character anywhere in the URL.
// Browsers strip tabs/newlines inside URLs, so `java\tscript:` must not slip through.
function hasForbiddenUrlChar(url: string): boolean {
  if (url.includes('\\')) return true;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    if (
      c <= 0x20 || (c >= 0x7f && c <= 0xa0) || c === 0xad || c === 0x1680 ||
      (c >= 0x2000 && c <= 0x200f) || (c >= 0x2028 && c <= 0x202f) ||
      (c >= 0x205f && c <= 0x206f) || c === 0x3000 || c === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

/**
 * True when `url` may be stored and rendered as a link: an absolute `https:` URL
 * (with a host and no userinfo) or a same-origin path beginning with a single `/`.
 * Strict by design: the string must already be in canonical form, nothing is trimmed.
 * Empty/absent is NOT handled here (the link is optional); callers check presence first.
 */
export function isAllowedNoticeLinkUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > NOTICE_LINK_URL_MAX_LENGTH) {
    return false;
  }
  if (hasForbiddenUrlChar(url)) return false;

  if (url.startsWith('/')) {
    // `//host` is protocol-relative. (`/\host` is covered by the backslash ban above.)
    return !url.startsWith('//');
  }

  if (!/^https:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname !== '' && parsed.username === '' && parsed.password === '';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Time: liveness (F009) and status (F010)
// ---------------------------------------------------------------------------

function toMillis(value: NoticeTimestamp): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

type NoticeWindow = { starts_at?: NoticeTimestamp; ends_at?: NoticeTimestamp };

/** Live when now >= starts_at (or no start) and now < ends_at (or no end). */
export function isNoticeLive(notice: NoticeWindow, now: Date): boolean {
  return getNoticeStatus(notice, now) === 'live';
}

/**
 * Derived status for a given instant. Unparseable timestamps are treated as absent
 * (storage is timestamptz, so this is only defensive).
 */
export function getNoticeStatus(notice: NoticeWindow, now: Date): NoticeStatus {
  const t = now.getTime();
  const start = toMillis(notice.starts_at);
  const end = toMillis(notice.ends_at);
  if (start !== null && t < start) return 'scheduled';
  if (end !== null && t >= end) return 'expired';
  return 'live';
}

// ---------------------------------------------------------------------------
// Dismissibility (F008)
// ---------------------------------------------------------------------------

/** Read-side rule: critical is never dismissible, whatever the stored flag says. */
export function isNoticeDismissible(notice: Pick<ClientPortalNoticeInput, 'severity' | 'dismissible'>): boolean {
  return notice.severity !== 'critical' && notice.dismissible === true;
}

/** Write-side normalizer: forces dismissible=false for critical. */
export function normalizeNoticeInput<T extends Pick<ClientPortalNoticeInput, 'severity' | 'dismissible'>>(input: T): T {
  return { ...input, dismissible: isNoticeDismissible(input) };
}

// ---------------------------------------------------------------------------
// Locale resolution (F011)
// ---------------------------------------------------------------------------

export interface ResolvedNoticeContent {
  /** The key that supplied the message: a locale or 'default'. */
  locale: SupportedLocale | typeof NOTICE_DEFAULT_LOCALE_KEY;
  message: string;
  linkLabel: string | null;
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Picks the user's locale entry if it exists with a non-empty message, else `default`.
 * A region tag ('fr-CA') is collapsed via normalizeLocale, as the rest of the app does.
 * The link label falls back to the default's label when the matched locale has none:
 * the link is notice-wide (one link_url), so a translated message should still get a
 * label rather than silently lose its link text; an authored label always wins.
 */
export function resolveNoticeContent(content: NoticeContent, userLocale?: string | null): ResolvedNoticeContent {
  const fallback = content[NOTICE_DEFAULT_LOCALE_KEY];
  const normalized = normalizeLocale(userLocale);
  const candidate = normalized ? content[normalized] : undefined;

  if (normalized && candidate && nonEmpty(candidate.message)) {
    return {
      locale: normalized,
      message: candidate.message,
      linkLabel: nonEmpty(candidate.linkLabel) ?? nonEmpty(fallback?.linkLabel),
    };
  }
  return {
    locale: NOTICE_DEFAULT_LOCALE_KEY,
    message: fallback?.message ?? '',
    linkLabel: nonEmpty(fallback?.linkLabel),
  };
}

// ---------------------------------------------------------------------------
// Validation (F006)
// ---------------------------------------------------------------------------

export type NoticeValidationCode =
  | 'required'
  | 'invalid_type'
  | 'invalid_value'
  | 'too_long'
  | 'invalid_url'
  | 'link_label_requires_url'
  | 'unsupported_locale'
  | 'invalid_date'
  | 'ends_before_start'
  | 'audience_empty';

export interface NoticeValidationError {
  /** Dotted field path, e.g. `content.default.message`, `content.fr.linkLabel`, `ends_at`. */
  path: string;
  /** Stable key; the UI owns the English/translated text. */
  code: NoticeValidationCode;
}

export interface NoticeValidationResult {
  valid: boolean;
  errors: NoticeValidationError[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates untrusted notice input and reports every problem, field-addressable.
 * Never throws. Decisions:
 * - A link label without a link_url is an error (`link_label_requires_url`): the label
 *   would be dead data and the author likely forgot the URL.
 * - clients/tags audiences require a non-empty list; an empty list would silently
 *   target nobody. `all` ignores the lists.
 * - Content keys must be `default` or a supported locale.
 * - Lengths count UTF-16 code units of the raw string (what a DB/maxlength sees);
 *   the default message is trimmed only for the emptiness check.
 */
export function validateNoticeInput(input: unknown): NoticeValidationResult {
  const errors: NoticeValidationError[] = [];
  const add = (path: string, code: NoticeValidationCode) => errors.push({ path, code });

  if (!isRecord(input)) {
    return { valid: false, errors: [{ path: '', code: 'invalid_type' }] };
  }

  if (!(NOTICE_SEVERITIES as readonly string[]).includes(input.severity as string)) {
    add('severity', 'invalid_value');
  }
  if (!(NOTICE_AUDIENCE_TYPES as readonly string[]).includes(input.audience_type as string)) {
    add('audience_type', 'invalid_value');
  }
  if (typeof input.dismissible !== 'boolean') add('dismissible', 'invalid_type');

  // content
  let anyLabel = false;
  if (!isRecord(input.content)) {
    add('content', 'required');
    add('content.default.message', 'required');
  } else {
    const def = input.content[NOTICE_DEFAULT_LOCALE_KEY];
    if (!isRecord(def) || typeof def.message !== 'string' || def.message.trim() === '') {
      add('content.default.message', 'required');
    }
    for (const [key, entry] of Object.entries(input.content)) {
      if (key !== NOTICE_DEFAULT_LOCALE_KEY && !isSupportedLocale(key)) {
        add(`content.${key}`, 'unsupported_locale');
        continue;
      }
      if (!isRecord(entry)) {
        if (key !== NOTICE_DEFAULT_LOCALE_KEY) add(`content.${key}`, 'invalid_type');
        continue;
      }
      if (entry.message !== undefined && typeof entry.message !== 'string') {
        add(`content.${key}.message`, 'invalid_type');
      } else if (typeof entry.message === 'string' && entry.message.length > NOTICE_MESSAGE_MAX_LENGTH) {
        add(`content.${key}.message`, 'too_long');
      }
      if (entry.linkLabel !== undefined && entry.linkLabel !== null) {
        if (typeof entry.linkLabel !== 'string') {
          add(`content.${key}.linkLabel`, 'invalid_type');
        } else {
          if (entry.linkLabel.length > NOTICE_LINK_LABEL_MAX_LENGTH) add(`content.${key}.linkLabel`, 'too_long');
          if (entry.linkLabel.trim() !== '') anyLabel = true;
        }
      }
    }
  }

  // link
  const hasUrl = input.link_url !== undefined && input.link_url !== null && input.link_url !== '';
  if (hasUrl && !isAllowedNoticeLinkUrl(input.link_url)) {
    add('link_url', 'invalid_url');
  } else if (!hasUrl && anyLabel) {
    add('link_url', 'link_label_requires_url');
  }

  // dates
  const hasStart = input.starts_at !== undefined && input.starts_at !== null && input.starts_at !== '';
  const hasEnd = input.ends_at !== undefined && input.ends_at !== null && input.ends_at !== '';
  const start = hasStart ? toMillis(input.starts_at as NoticeTimestamp) : null;
  const end = hasEnd ? toMillis(input.ends_at as NoticeTimestamp) : null;
  if (hasStart && start === null) add('starts_at', 'invalid_date');
  if (hasEnd && end === null) add('ends_at', 'invalid_date');
  if (start !== null && end !== null && end <= start) add('ends_at', 'ends_before_start');

  // audience
  const listField =
    input.audience_type === 'clients' ? 'audience_client_ids'
    : input.audience_type === 'tags' ? 'audience_tag_ids'
    : null;
  if (listField) {
    const list = input[listField];
    if (!Array.isArray(list) || list.length === 0) {
      add(listField, 'audience_empty');
    } else if (!list.every((id) => typeof id === 'string' && id.length > 0)) {
      add(listField, 'invalid_value');
    }
  }

  return { valid: errors.length === 0, errors };
}
