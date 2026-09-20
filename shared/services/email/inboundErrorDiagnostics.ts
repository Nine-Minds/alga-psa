/**
 * Bounded, primitive-only descriptions of thrown values on the inbound email
 * path.
 *
 * Two problems this exists for, both observed on CI run 35492001110:
 *
 * 1. The first exception was invisible. A disposition collapsed from `defer` to
 *    `retry` and the only thing reported was the collapsed disposition, so the
 *    error that caused it could not be named.
 * 2. The reporter then failed with `Maximum call stack size exceeded` while
 *    serializing the failure, which hid even the truncated payload. knex mutates
 *    thrown errors in place (`runner.js` assigns `sql` and `bindings` onto the
 *    error), errors can carry `cause` chains, and Vitest's serializer walks
 *    every own property of every prototype in the chain with no depth cap. An
 *    error that escapes to the reporter with a query client or a cyclic cause
 *    attached is therefore an unbounded walk.
 *
 * So: never hand a raw thrown value to anything that reports. Reduce it to
 * primitives here first. Nothing in this module reads `sql`, `bindings`,
 * `client`, a transaction, or any credential-bearing field, and the cause chain
 * is followed exactly one level.
 */

/** Generous enough that realistic messages are verbatim; bounded regardless. */
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CODE_LENGTH = 120;

export interface InboundErrorSummary {
  /** Constructor-independent discriminator. Empty string when absent. */
  name: string;
  /** `code` when it is a string or number, else null. Never an object. */
  code: string | null;
  message: string;
  /** One level only: `name|code|message` of a direct cause, never a chain. */
  cause: string | null;
}

function boundedString(value: unknown, limit: number): string | null {
  if (typeof value === 'string') return value.length > limit ? `${value.slice(0, limit)}…` : value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return boundedString(String(value), limit);
  }
  return null;
}

/**
 * The message to compare against sentinels and to persist as failure
 * provenance. Always a bounded string, so a thrown value whose `message` is not
 * a string cannot put a walkable object into a disposition or a database row.
 */
export function inboundErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const named = boundedString((error as { message?: unknown }).message, MAX_MESSAGE_LENGTH);
    if (named !== null && named !== '') return named;
  }
  if (typeof error === 'string') return boundedString(error, MAX_MESSAGE_LENGTH)!;
  // `String(error)` on a thrown object with a hostile toString can still throw.
  try {
    return boundedString(String(error), MAX_MESSAGE_LENGTH) ?? 'unserializable_error';
  } catch {
    return 'unserializable_error';
  }
}

function summarizeShallow(error: unknown): Omit<InboundErrorSummary, 'cause'> {
  const record = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  return {
    name: boundedString(record.name, MAX_CODE_LENGTH) ?? (typeof error === 'object' && error !== null ? '' : typeof error),
    code: boundedString(record.code, MAX_CODE_LENGTH),
    message: inboundErrorMessage(error),
  };
}

export function summarizeInboundError(error: unknown): InboundErrorSummary {
  const shallow = summarizeShallow(error);
  const rawCause = error && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined;
  if (rawCause === undefined || rawCause === null) return { ...shallow, cause: null };
  // Exactly one level. A cause that points back at its own error -- or at a
  // longer chain -- must not turn this into a walk.
  const cause = summarizeShallow(rawCause);
  return { ...shallow, cause: `${cause.name}|${cause.code ?? ''}|${cause.message}` };
}

export type InboundDiagnosticStage =
  | 'admission'
  | 'rollback'
  | 'lifecycle_classification'
  | 'disposition';

/**
 * Emit one line of primitives. Vitest keeps console output for failing tests
 * (`silent: 'passed-only'`), so this is what names the first exception when a
 * disposition assertion fails in a shard that cannot be reproduced locally.
 *
 * `context` is caller-supplied and must already be primitive; it is spread as
 * given and never traversed.
 */
export function recordInboundDiagnostic(
  stage: InboundDiagnosticStage,
  context: Record<string, string | number | boolean | null | undefined>,
  error?: unknown,
): void {
  const payload: Record<string, unknown> = { stage, ...context };
  if (arguments.length >= 3) {
    const summary = summarizeInboundError(error);
    payload.errorName = summary.name;
    payload.errorCode = summary.code;
    payload.errorMessage = summary.message;
    payload.errorCause = summary.cause;
  }
  console.warn('[inbound-email-diagnostic]', JSON.stringify(payload));
}
