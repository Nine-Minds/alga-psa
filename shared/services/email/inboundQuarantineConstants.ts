/**
 * Client-safe constants for inbound email quarantine (no Node imports), so the
 * MSP queue UI and the shared persistence module read one closed set.
 */

/**
 * The closed set of quarantine reasons (enforced by the TypeScript type only).
 * Adding a reason is one entry here: the result type follows, and no migration
 * is needed because the reason column has no CHECK constraint. Optionally add a
 * locale label `quarantine.reasons.<reason>` and a plain-language description in
 * the notification service; both fall back to generic text when missing.
 */
export const QUARANTINE_REASONS = [
  'unauthorized_thread_header_sender',
  'reply_outside_sender_audience',
  'co_managed_token_refused',
  'co_managed_token_unserved',
  'co_managed_sender_unauthenticated',
] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

export const QUARANTINE_MATCHED_BY = ['thread_headers', 'reply_token'] as const;
export type QuarantineMatchedBy = (typeof QUARANTINE_MATCHED_BY)[number];

export const QUARANTINE_STATUSES = ['open', 'dismissed'] as const;
export type QuarantineStatus = (typeof QUARANTINE_STATUSES)[number];

export const QUARANTINE_SUBJECT_MAX_LENGTH = 200;
/** Per tenant+mailbox rows accepted per UTC day; beyond this a flood is logged, not stored. */
export const QUARANTINE_DAILY_ROW_CAP_PER_MAILBOX = 500;
/** Dismissed rows older than this are pruned by the `cleanup-inbound-email-quarantine` job. */
export const QUARANTINE_DISMISSED_RETENTION_DAYS = 90;
/** At most one notification per (tenant, mailbox, reason) per this window. */
export const QUARANTINE_NOTIFICATION_WINDOW_MINUTES = 15;
