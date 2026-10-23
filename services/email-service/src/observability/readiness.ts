/**
 * Dependency / heartbeat checks shared by `/ready` and `/status`.
 *
 * `/ready` (and therefore the readinessProbe) fails only on: DB down, Redis
 * down, or a wedged consumer (F8). Fleet-health conditions never come through
 * here.
 */

export const READY_CHECK_TIMEOUT_MS = 2_000;
export const READY_STARTUP_GRACE_MS = 60_000;

export interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  /** Short fixed string: `timeout`, `refused`, `stale`, `starting` or `error`. Never free text. */
  error?: string;
  /** Heartbeat checks only: no tick yet, still inside the startup grace. */
  starting?: boolean;
  /** Heartbeat checks only: epoch ms of the last successful tick. */
  lastTickMs?: number | null;
}

export class CheckTimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'CheckTimeoutError';
  }
}

export async function withTimeout<T>(work: Promise<T> | (() => Promise<T>), ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const promise = typeof work === 'function' ? work() : work;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new CheckTimeoutError()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // The losing promise may reject later; make sure that is never unhandled.
    promise.catch(() => undefined);
  }
}

function describeError(error: unknown): string {
  if (error instanceof CheckTimeoutError) return 'timeout';
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') return 'refused';
  return 'error';
}

export async function runCheck(
  fn: () => Promise<unknown>,
  timeoutMs: number = READY_CHECK_TIMEOUT_MS
): Promise<CheckResult> {
  const started = Date.now();
  try {
    await withTimeout(fn, timeoutMs);
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, error: describeError(error) };
  }
}

export interface ConsumerHeartbeatSource {
  readonly lastSuccessfulTickAt: number | null;
  readonly heartbeatStaleAfterMs: number;
  readonly startedAt: number;
}

export function checkConsumerHeartbeat(
  consumer: ConsumerHeartbeatSource,
  nowMs: number = Date.now(),
  startupGraceMs: number = READY_STARTUP_GRACE_MS
): CheckResult {
  const last = consumer.lastSuccessfulTickAt;
  if (last === null) {
    if (nowMs - consumer.startedAt < startupGraceMs) {
      return { ok: true, starting: true, lastTickMs: null };
    }
    return { ok: false, error: 'stale', lastTickMs: null };
  }
  const stale = nowMs - last > consumer.heartbeatStaleAfterMs;
  return stale ? { ok: false, error: 'stale', lastTickMs: last } : { ok: true, lastTickMs: last };
}

export interface ReadinessChecks {
  db: CheckResult;
  redis: CheckResult;
  consumer_v1: CheckResult;
  consumer_v2?: CheckResult;
}

export interface ReadinessResult {
  ok: boolean;
  checks: ReadinessChecks;
  checkedAtMs: number;
}

export interface ReadinessDeps {
  checkDb: () => Promise<unknown>;
  checkRedis: () => Promise<unknown>;
  consumerV1: () => ConsumerHeartbeatSource | undefined;
  consumerV2: () => ConsumerHeartbeatSource | undefined;
  timeoutMs?: number;
  now?: () => number;
}

export function createReadiness(deps: ReadinessDeps) {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? READY_CHECK_TIMEOUT_MS;
  let cached: ReadinessResult | undefined;

  async function run(): Promise<ReadinessResult> {
    const [db, redis] = await Promise.all([runCheck(deps.checkDb, timeoutMs), runCheck(deps.checkRedis, timeoutMs)]);
    const t = now();
    const v1 = deps.consumerV1();
    const v2 = deps.consumerV2();
    const checks: ReadinessChecks = {
      db,
      redis,
      // Not constructed yet: the process is still starting, so it is not ready.
      consumer_v1: v1 ? checkConsumerHeartbeat(v1, t) : { ok: false, starting: true, error: 'starting', lastTickMs: null },
    };
    if (v2) checks.consumer_v2 = checkConsumerHeartbeat(v2, t);
    const ok = Object.values(checks).every((c) => c.ok);
    return (cached = { ok, checks, checkedAtMs: t });
  }

  /** `/status` reuses a result younger than `maxAgeMs` so it cannot hammer the dependencies. */
  async function runCached(maxAgeMs: number = 5_000): Promise<ReadinessResult> {
    if (cached && now() - cached.checkedAtMs < maxAgeMs) return cached;
    return run();
  }

  return { run, runCached };
}
