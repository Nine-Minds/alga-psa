/**
 * Process-wide admission control for workflow expression evaluation.
 *
 * The per-invocation budgets in expressionEngine.ts bound ONE evaluation; they
 * say nothing about how many run at once. This module adds a weighted
 * semaphore with a bounded wait queue so that N concurrent legal-but-expensive
 * evaluations cannot together exhaust the heap / starve the event loop.
 *
 * Environment contract: expressionEngine.ts is also bundled into Temporal's
 * deterministic workflow sandbox and into browser code, so this file must not
 * import node builtins statically. AsyncLocalStorage is discovered lazily via
 * `process.getBuiltinModule`; where it is unavailable (sandbox, browser) there
 * is no shared process to protect and admission is a passthrough - the
 * deterministic step/byte budgets still apply.
 *
 * Knobs (the only two): WORKFLOW_EVAL_MAX_CONCURRENCY, WORKFLOW_EVAL_QUEUE_TIMEOUT_MS.
 */

export const DEFAULT_MAX_CONCURRENCY = 6;
export const DEFAULT_QUEUE_TIMEOUT_MS = 2_000;
const MAX_CONCURRENCY_CEILING = 64;
const MAX_QUEUE_TIMEOUT_MS = 60_000;
/** Waiters beyond capacity * this factor are rejected immediately instead of queued. */
const QUEUE_LENGTH_PER_SLOT = 8;

export type EvaluationBudgetKind = 'steps' | 'bytes' | 'cpu' | 'wall' | 'aborted';

/** Thrown by every per-evaluation budget (steps, bytes, cpu and wall deadlines). */
export class EvaluationBudgetExceededError extends Error {
  readonly code = 'EVALUATION_BUDGET_EXCEEDED';
  constructor(message: string, readonly kind: EvaluationBudgetKind = 'steps') {
    super(message);
    this.name = 'EvaluationBudgetExceededError';
  }
}

/**
 * Thrown when no evaluation slot became available in time. Carries `status`
 * and `retryAfterSeconds` so HTTP boundaries can map it to 429 + Retry-After.
 * Internal (non-HTTP) callers must let it propagate: admission fails closed.
 */
export class EvaluationBusyError extends Error {
  readonly code = 'EVALUATION_BUSY';
  readonly status = 429;
  constructor(
    message: string,
    readonly reason: 'queue_timeout' | 'queue_full',
    readonly retryAfterSeconds: number,
    readonly waitedMs: number,
    readonly queueDepth: number
  ) {
    super(message);
    this.name = 'EvaluationBusyError';
  }
}

// ---------------------------------------------------------------------------
// Telemetry: dependency-free sink (same shape as inboundEmailMetrics) + counters
// ---------------------------------------------------------------------------

export type ExpressionAdmissionEvent =
  | { type: 'acquired'; waitedMs: number; queueDepth: number; active: number; capacity: number }
  | { type: 'released'; heldMs: number; active: number; capacity: number }
  | { type: 'busy'; reason: 'queue_timeout' | 'queue_full'; waitedMs: number; queueDepth: number; active: number; capacity: number }
  | { type: 'deadline_exceeded'; kind: EvaluationBudgetKind; message: string }
  | { type: 'rate_limited'; scope: 'tenant' | 'user'; action: string; retryAfterSeconds: number };

export type ExpressionAdmissionSink = (event: ExpressionAdmissionEvent) => void;

export type ExpressionAdmissionStats = {
  capacity: number;
  active: number;
  queueDepth: number;
  acquired: number;
  busyRejections: number;
  deadlineExceeded: number;
  rateLimited: number;
  lastWaitMs: number;
  maxWaitMs: number;
  totalWaitMs: number;
};

const counters = { acquired: 0, busyRejections: 0, deadlineExceeded: 0, rateLimited: 0, lastWaitMs: 0, maxWaitMs: 0, totalWaitMs: 0 };
let sink: ExpressionAdmissionSink | null = null;

export function setExpressionAdmissionSink(next: ExpressionAdmissionSink | null): void {
  sink = next;
}

/** Counts the event and forwards it to the sink. A throwing sink never breaks evaluation. */
export function reportExpressionAdmissionEvent(event: ExpressionAdmissionEvent): void {
  switch (event.type) {
    case 'acquired':
      counters.acquired += 1;
      counters.lastWaitMs = event.waitedMs;
      counters.totalWaitMs += event.waitedMs;
      counters.maxWaitMs = Math.max(counters.maxWaitMs, event.waitedMs);
      break;
    case 'busy':
      counters.busyRejections += 1;
      break;
    case 'deadline_exceeded':
      counters.deadlineExceeded += 1;
      break;
    case 'rate_limited':
      counters.rateLimited += 1;
      break;
    default:
      break;
  }
  try {
    sink?.(event);
  } catch {
    // metrics must never break expression evaluation
  }
}

export function getExpressionAdmissionStats(): ExpressionAdmissionStats {
  const semaphore = getSemaphore();
  return { capacity: semaphore.capacity, active: semaphore.active, queueDepth: semaphore.queued, ...counters };
}

// ---------------------------------------------------------------------------
// Weighted semaphore
// ---------------------------------------------------------------------------

type Lease = { readonly weight: number; released: boolean; readonly acquiredAt: number };
type Waiter = {
  weight: number;
  enqueuedAt: number;
  resolve: (lease: Lease) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
};

class WeightedSemaphore {
  private inUse = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    readonly capacity: number,
    readonly queueTimeoutMs: number
  ) {}

  get active(): number {
    return this.inUse;
  }

  get queued(): number {
    return this.waiters.length;
  }

  acquire(weight: number, queueTimeoutMs: number, signal?: AbortSignal): Promise<Lease> {
    const units = Math.min(this.capacity, Math.max(1, Math.ceil(weight)));
    const enqueuedAt = Date.now();
    if (signal?.aborted) return Promise.reject(abortReason(signal));

    // Strict FIFO: a free slot is only taken directly when nobody is waiting.
    if (this.waiters.length === 0 && this.inUse + units <= this.capacity) {
      return Promise.resolve(this.grant(units, enqueuedAt));
    }
    if (this.waiters.length >= this.capacity * QUEUE_LENGTH_PER_SLOT) {
      return Promise.reject(this.busy('queue_full', 0));
    }

    return new Promise<Lease>((resolve, reject) => {
      const waiter: Waiter = {
        weight: units,
        enqueuedAt,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
        },
      };
      const remove = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
      };
      const timer = setTimeout(() => {
        remove();
        waiter.cleanup();
        reject(this.busy('queue_timeout', Date.now() - enqueuedAt));
        // A removed head-of-line waiter may have been blocking smaller ones.
        this.drain();
      }, queueTimeoutMs);
      (timer as { unref?: () => void }).unref?.();
      const onAbort = () => {
        remove();
        waiter.cleanup();
        reject(abortReason(signal!));
        this.drain();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  release(lease: Lease): void {
    if (lease.released) return;
    lease.released = true;
    this.inUse -= lease.weight;
    reportExpressionAdmissionEvent({
      type: 'released',
      heldMs: Date.now() - lease.acquiredAt,
      active: this.inUse,
      capacity: this.capacity,
    });
    this.drain();
  }

  private grant(weight: number, enqueuedAt: number): Lease {
    this.inUse += weight;
    const lease: Lease = { weight, released: false, acquiredAt: Date.now() };
    reportExpressionAdmissionEvent({
      type: 'acquired',
      waitedMs: lease.acquiredAt - enqueuedAt,
      queueDepth: this.waiters.length,
      active: this.inUse,
      capacity: this.capacity,
    });
    return lease;
  }

  private drain(): void {
    while (this.waiters.length > 0 && this.inUse + this.waiters[0].weight <= this.capacity) {
      const waiter = this.waiters.shift()!;
      waiter.cleanup();
      waiter.resolve(this.grant(waiter.weight, waiter.enqueuedAt));
    }
  }

  private busy(reason: 'queue_timeout' | 'queue_full', waitedMs: number): EvaluationBusyError {
    const error = new EvaluationBusyError(
      reason === 'queue_full'
        ? 'Workflow expression evaluation is at capacity; try again shortly'
        : `Workflow expression evaluation is busy; no slot became available within ${this.queueTimeoutMs}ms`,
      reason,
      Math.max(1, Math.ceil(this.queueTimeoutMs / 1000)),
      waitedMs,
      this.waiters.length
    );
    reportExpressionAdmissionEvent({
      type: 'busy',
      reason,
      waitedMs,
      queueDepth: this.waiters.length,
      active: this.inUse,
      capacity: this.capacity,
    });
    return error;
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new EvaluationBudgetExceededError('Expression evaluation was aborted before admission', 'aborted');
}

// ---------------------------------------------------------------------------
// Configuration (lazy, so tests and late env loading both work)
// ---------------------------------------------------------------------------

function readIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

let semaphore: WeightedSemaphore | null = null;

function getSemaphore(): WeightedSemaphore {
  if (!semaphore) {
    semaphore = new WeightedSemaphore(
      readIntegerEnv('WORKFLOW_EVAL_MAX_CONCURRENCY', DEFAULT_MAX_CONCURRENCY, 1, MAX_CONCURRENCY_CEILING),
      readIntegerEnv('WORKFLOW_EVAL_QUEUE_TIMEOUT_MS', DEFAULT_QUEUE_TIMEOUT_MS, 1, MAX_QUEUE_TIMEOUT_MS)
    );
  }
  return semaphore;
}

/** Test support: rebuild the semaphore (from env, or with explicit overrides) and zero the counters. */
export function resetExpressionAdmission(overrides?: { maxConcurrency?: number; queueTimeoutMs?: number }): void {
  semaphore = overrides
    ? new WeightedSemaphore(
        overrides.maxConcurrency ?? readIntegerEnv('WORKFLOW_EVAL_MAX_CONCURRENCY', DEFAULT_MAX_CONCURRENCY, 1, MAX_CONCURRENCY_CEILING),
        overrides.queueTimeoutMs ?? readIntegerEnv('WORKFLOW_EVAL_QUEUE_TIMEOUT_MS', DEFAULT_QUEUE_TIMEOUT_MS, 1, MAX_QUEUE_TIMEOUT_MS)
      )
    : null;
  Object.assign(counters, { acquired: 0, busyRejections: 0, deadlineExceeded: 0, rateLimited: 0, lastWaitMs: 0, maxWaitMs: 0, totalWaitMs: 0 });
}

// ---------------------------------------------------------------------------
// Reentrant admission
// ---------------------------------------------------------------------------

type AdmissionToken = { lease: Lease };
type AsyncLocalStorageLike = {
  run<R>(store: AdmissionToken, callback: () => R): R;
  getStore(): AdmissionToken | undefined;
};

let storage: AsyncLocalStorageLike | null | undefined;

function createAsyncLocalStorage<T>(): { run<R>(store: T, callback: () => R): R; getStore(): T | undefined } | null {
  const getBuiltinModule = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule;
  const hooks = typeof getBuiltinModule === 'function'
    ? (getBuiltinModule.call((globalThis as { process?: unknown }).process, 'node:async_hooks') as
        | { AsyncLocalStorage?: new () => { run<R>(store: T, callback: () => R): R; getStore(): T | undefined } }
        | undefined)
    : undefined;
  return hooks?.AsyncLocalStorage ? new hooks.AsyncLocalStorage() : null;
}

function getStorage(): AsyncLocalStorageLike | null {
  if (storage === undefined) storage = createAsyncLocalStorage<AdmissionToken>();
  return storage;
}

/** True when this runtime shares a process-wide semaphore (Node); false in the sandbox/browser. */
export function isExpressionAdmissionActive(): boolean {
  return getStorage() !== null;
}

export type AdmissionOptions = {
  /** Slots this evaluation occupies (default 1, clamped to capacity). */
  weight?: number;
  /** Overrides WORKFLOW_EVAL_QUEUE_TIMEOUT_MS for this call. */
  queueTimeoutMs?: number;
  /** Aborts the wait for a slot. */
  signal?: AbortSignal;
};

/**
 * Run `fn` while holding an evaluation slot. A nested call made from inside an
 * already-admitted async context reuses the outer slot (via AsyncLocalStorage)
 * rather than queueing behind itself, so nesting can never deadlock - even with
 * a single slot. A context whose slot was already released (an orphan that
 * outlived its wall deadline) is NOT treated as holding one.
 */
export async function runWithAdmission<T>(options: AdmissionOptions, fn: () => Promise<T>): Promise<T> {
  const als = getStorage();
  if (!als) return fn();

  const held = als.getStore();
  if (held && !held.lease.released) return fn();

  const gate = getSemaphore();
  const lease = await gate.acquire(options.weight ?? 1, options.queueTimeoutMs ?? gate.queueTimeoutMs, options.signal);
  try {
    return await als.run({ lease }, fn);
  } finally {
    gate.release(lease);
  }
}

// ---------------------------------------------------------------------------
// Per-request ceiling
// ---------------------------------------------------------------------------

/**
 * The per-evaluation budgets bound ONE evaluation. A single request (a draft
 * simulation, a webhook delivery) can run hundreds of them, so a request scope
 * carries one shared deadline - start time, accumulated CPU and one wall timer
 * - that every evaluation inside it charges through the existing evaluate hooks.
 */
export type EvaluationRequestBudgetOptions = {
  cpuBudgetMs: number;
  wallBudgetMs: number;
  signal?: AbortSignal;
  /** Clock seams for tests. */
  now?: () => number;
  cpuNow?: () => number;
};

export type EvaluationRequestDeadline = {
  readonly startedAt: number;
  readonly cpuBudgetMs: number;
  readonly wallBudgetMs: number;
  readonly now: () => number;
  readonly cpuNow: (() => number) | null;
  readonly controller: AbortController;
  cpuSpentMs: number;
  lastCpuSample: number | null;
  inFlight: number;
  checks: number;
  finished: boolean;
};

let requestStorage: { run<R>(store: EvaluationRequestDeadline, callback: () => R): R; getStore(): EvaluationRequestDeadline | undefined } | null | undefined;

function getRequestStorage() {
  if (requestStorage === undefined) requestStorage = createAsyncLocalStorage<EvaluationRequestDeadline>();
  return requestStorage;
}

export function requestWallMessage(wallBudgetMs: number): string {
  return `Request expression budget exceeded (${wallBudgetMs}ms wall-clock for all evaluations in this request)`;
}

export function requestCpuMessage(cpuBudgetMs: number): string {
  return `Request expression budget exceeded (${cpuBudgetMs}ms CPU for all evaluations in this request)`;
}

type CpuUsage = { user: number; system: number };

/**
 * Clock (ms) for the CPU budgets: CPU of the thread running the evaluation, never the whole process.
 *
 * process.cpuUsage() sums every thread in the process (V8 GC helpers, the libuv pool, Temporal worker
 * threads, Turbopack in dev). Charging that to whichever evaluation is in flight failed ordinary
 * millisecond expressions with "250ms CPU budget" whenever other threads were busy, so it is not used.
 *
 * Node >= 23.9 / 22.19 exposes process.threadCpuUsage(). Older Node has no per-thread CPU counter;
 * there the monotonic clock is used instead: JSONata yields only to microtasks, so time elapsed on this
 * thread between hook checks bounds this thread's CPU and cannot count other threads.
 */
export function evaluationCpuClock(): (() => number) | null {
  if (!isExpressionAdmissionActive()) return null;
  const proc = (globalThis as { process?: { threadCpuUsage?: () => CpuUsage } }).process;
  if (typeof proc?.threadCpuUsage === 'function') {
    const threadCpuUsage = proc.threadCpuUsage.bind(proc);
    return () => {
      const usage = threadCpuUsage();
      return (usage.user + usage.system) / 1000;
    };
  }
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  if (typeof perf?.now === 'function') {
    const now = perf.now.bind(perf);
    return () => now();
  }
  return null;
}

/** The deadline of the enclosing request scope, if any and still open. */
export function getEvaluationRequestDeadline(): EvaluationRequestDeadline | undefined {
  const active = getRequestStorage()?.getStore();
  return active && !active.finished ? active : undefined;
}

/** Charge this thread's CPU since the last sample to the request (fair-shared across active slots). */
export function chargeRequestCpu(request: EvaluationRequestDeadline): void {
  if (!request.cpuNow) return;
  const sample = request.cpuNow();
  const inFlight = Math.max(1, getSemaphore().active);
  request.cpuSpentMs += (sample - (request.lastCpuSample ?? sample)) / inFlight;
  request.lastCpuSample = sample;
}

/** Called as an evaluation starts/ends so CPU spent between evaluations (I/O, other work) is not charged. */
export function beginRequestEvaluation(request: EvaluationRequestDeadline): void {
  if (request.inFlight === 0 && request.cpuNow) request.lastCpuSample = request.cpuNow();
  request.inFlight += 1;
}

export function endRequestEvaluation(request: EvaluationRequestDeadline): void {
  request.inFlight = Math.max(0, request.inFlight - 1);
  chargeRequestCpu(request);
}

/**
 * Run `fn` inside a request scope. Every evaluation started within it (through
 * evaluateWorkflowExpression) is charged against one shared CPU and wall budget.
 * A nested scope reuses the outer one so it cannot be used to reset the ceiling.
 * Where no AsyncLocalStorage exists (sandbox, browser) this is a passthrough.
 */
export async function runWithEvaluationRequestBudget<T>(
  options: EvaluationRequestBudgetOptions,
  fn: () => Promise<T>
): Promise<T> {
  const als = getRequestStorage();
  if (!als) return fn();
  if (getEvaluationRequestDeadline()) return fn();

  const now = options.now ?? Date.now;
  const cpuNow = options.cpuNow ?? evaluationCpuClock();
  const controller = new AbortController();
  const request: EvaluationRequestDeadline = {
    startedAt: now(),
    cpuBudgetMs: options.cpuBudgetMs,
    wallBudgetMs: options.wallBudgetMs,
    now,
    cpuNow,
    controller,
    cpuSpentMs: 0,
    lastCpuSample: cpuNow ? cpuNow() : null,
    inFlight: 0,
    checks: 0,
    finished: false,
  };
  const onCallerAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener('abort', onCallerAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  if (!options.now) {
    timer = setTimeout(
      () => controller.abort(new EvaluationBudgetExceededError(requestWallMessage(options.wallBudgetMs), 'wall')),
      options.wallBudgetMs
    );
    (timer as { unref?: () => void }).unref?.();
  }
  try {
    return await als.run(request, fn);
  } finally {
    request.finished = true;
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}
