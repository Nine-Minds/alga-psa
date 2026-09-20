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
/**
 * Enough frames to show a repeating cycle twice over; bounded so a stack
 * overflow -- whose stack is thousands of frames long -- cannot itself become
 * the unbounded payload this module exists to prevent.
 */
const MAX_FRAMES = 14;
const MAX_FRAME_LENGTH = 200;

export interface InboundErrorSummary {
  /** Constructor-independent discriminator. Empty string when absent. */
  name: string;
  /** `code` when it is a string or number, else null. Never an object. */
  code: string | null;
  message: string;
  /** One level only: `name|code|message` of a direct cause, never a chain. */
  cause: string | null;
  /**
   * The topmost `MAX_FRAMES` stack frames, each bounded. For a
   * `RangeError: Maximum call stack size exceeded` the repeating cycle sits at
   * the top of the stack, so these frames name the recursion site -- the one
   * thing name/code/message cannot say.
   */
  frames: string[];
  /**
   * Why `frames` is empty, when it is; `null` when frames were read.
   *
   * Empty frames are not self-explaining, and on CI run 35524282543 that cost a
   * round: all three diagnostic stages fired with `RangeError: Maximum call
   * stack size exceeded` and *no* `errorFrames` key at all, which is consistent
   * with four different failures of `error.stack` that call for four different
   * next steps. Naming the branch is the difference between "the stack was
   * unreadable" and "the stack was readable and had no frames".
   */
  framesUnavailable: string | null;
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

/**
 * Bounded frames from `error.stack`. Never the whole stack: an overflow stack
 * is enormous, and the point of this module is that nothing unbounded reaches
 * a reporter. The message line is dropped (it is already reported separately)
 * and each frame is trimmed and truncated.
 */
function boundedFrames(error: unknown): { frames: string[]; unavailable: string | null } {
  let stack: unknown;
  // A hostile or exotic thrown value can throw from a `stack` getter -- and so
  // can an ordinary one. V8 formats `.stack` lazily on first access, vite-node
  // installs a source-mapping `prepareStackTrace`, and running that formatter
  // costs stack. Reading `.stack` while the stack is already exhausted can
  // therefore raise a *second* `RangeError` from the getter itself. That is not
  // a hypothetical: it is the leading explanation for the empty frames on run
  // 35524282543, so the branch is reported rather than swallowed.
  try {
    stack = (error as { stack?: unknown } | null | undefined)?.stack;
  } catch (stackError) {
    const thrown = (stackError as { name?: unknown } | null)?.name;
    return { frames: [], unavailable: `stack_getter_threw:${typeof thrown === 'string' ? thrown : 'unknown'}` };
  }
  if (typeof stack !== 'string') return { frames: [], unavailable: `stack_absent:${typeof stack}` };
  if (stack === '') return { frames: [], unavailable: 'stack_empty' };
  const frames = stack
    .split('\n')
    .filter((line) => /^\s*at\s/.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => {
      const trimmed = line.trim();
      return trimmed.length > MAX_FRAME_LENGTH ? `${trimmed.slice(0, MAX_FRAME_LENGTH)}…` : trimmed;
    });
  // A non-empty stack with no `at ` lines means the formatter returned
  // something -- a message-only stack, or a custom format -- rather than
  // failing. Record its length so the next reader knows there was text to look
  // at without putting the text itself into a reporter.
  if (frames.length === 0) return { frames: [], unavailable: `no_frame_lines:${stack.length}` };
  return { frames, unavailable: null };
}

function summarizeShallow(error: unknown): Omit<InboundErrorSummary, 'cause' | 'frames' | 'framesUnavailable'> {
  const record = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  return {
    name: boundedString(record.name, MAX_CODE_LENGTH) ?? (typeof error === 'object' && error !== null ? '' : typeof error),
    code: boundedString(record.code, MAX_CODE_LENGTH),
    message: inboundErrorMessage(error),
  };
}

export interface SummarizeInboundErrorOptions {
  /**
   * Read `error.stack`. Default `true`.
   *
   * Pass `false` at a boundary that must describe the error *without* risking
   * the read: accessing `.stack` can itself throw, and a caller placed to
   * observe an error before anything else touches it needs an observation that
   * cannot be the thing that destroys it.
   */
  readStack?: boolean;
}

export function summarizeInboundError(error: unknown, options: SummarizeInboundErrorOptions = {}): InboundErrorSummary {
  const { frames, unavailable } = options.readStack === false
    ? { frames: [] as string[], unavailable: 'stack_not_read' }
    : boundedFrames(error);
  const shallow = { ...summarizeShallow(error), frames, framesUnavailable: unavailable };
  const rawCause = error && typeof error === 'object' ? (error as { cause?: unknown }).cause : undefined;
  if (rawCause === undefined || rawCause === null) return { ...shallow, cause: null };
  // Exactly one level. A cause that points back at its own error -- or at a
  // longer chain -- must not turn this into a walk.
  const cause = summarizeShallow(rawCause);
  return { ...shallow, cause: `${cause.name}|${cause.code ?? ''}|${cause.message}` };
}

export type InboundDiagnosticStage =
  | 'admission'
  /**
   * The error as it leaves the commit transaction's own callback, observed
   * before any enclosing helper can touch it. `withAdminTransaction` reads
   * `error.stack` in its `catch` before rethrowing; if that read throws, the
   * error the caller finally sees is *not* the error the transaction raised.
   * This stage is the only place that can tell those two apart.
   */
  | 'commit_body'
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
  options: SummarizeInboundErrorOptions = {},
): void {
  const payload: Record<string, unknown> = { stage, ...context };
  if (arguments.length >= 3) {
    const summary = summarizeInboundError(error, options);
    payload.errorName = summary.name;
    payload.errorCode = summary.code;
    payload.errorMessage = summary.message;
    payload.errorCause = summary.cause;
    // Only when there is something to say, so an ordinary rejection keeps its
    // one short line.
    if (summary.frames.length > 0) payload.errorFrames = summary.frames;
    // Always say why when there are none. An absent `errorFrames` key used to
    // be ambiguous across four distinct failures of `error.stack`; it is not
    // any more.
    else payload.errorFramesUnavailable = summary.framesUnavailable;
    // Only meaningful alongside a frame failure, and cheap: a limit of 0 turns
    // every stack into the empty string and would explain the whole thing.
    if (summary.frames.length === 0) payload.stackTraceLimit = Error.stackTraceLimit ?? null;
  }
  console.warn('[inbound-email-diagnostic]', JSON.stringify(payload));
}
