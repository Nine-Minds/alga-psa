/**
 * Read-only Temporal readiness checks for diagnostics.
 *
 * These deliberately never start a workflow or mutate a schedule. A reachable
 * frontend proves the API answered; worker evidence comes from describing the
 * task queue's pollers, which is read-only and does not prove execution
 * succeeded for any particular workflow.
 */

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_TEMPORAL_TASK_QUEUE = 'tenant-workflows';
const ENTRA_SCHEDULE_ID_PREFIX = 'entra-all-tenants-sync-schedule';

export interface TemporalReadiness {
  reachable: boolean;
  address: string;
  namespace: string;
  taskQueue: string;
  workerEvidence: 'available' | 'none' | 'unknown';
  error?: string;
}

export interface EntraScheduleDescription {
  /** A schedule exists. */
  configured: boolean;
  /** The schedule lookup itself failed (connectivity/permission) vs not found. */
  lookupFailed: boolean;
  nextFireTime: string | null;
  /** Interval in minutes from the schedule spec, when readable. */
  intervalMinutes: number | null;
  /** Schedule paused state, when readable. */
  paused: boolean | null;
  error?: string;
}

function temporalConfig() {
  return {
    address: process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS,
    namespace: process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE,
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || DEFAULT_TEMPORAL_TASK_QUEUE,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Temporal request timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withTemporalClient<T>(
  fn: (client: any) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let connection: any = null;
  try {
    const mod: any = await import('@temporalio/client').catch(() => null);
    if (!mod) {
      return { ok: false, error: 'Temporal client is not available in this deployment.' };
    }
    const { address, namespace } = temporalConfig();
    connection = await withTimeout(mod.Connection.connect({ address }), 4000);
    const client = new mod.Client({ connection, namespace });
    const value = await fn(client);
    return { ok: true, value };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Temporal frontend is unreachable.' };
  } finally {
    try {
      connection?.close?.();
    } catch {
      // best-effort close
    }
  }
}

function isScheduleNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as any).message || '');
  const name = String((error as any).name || '');
  const code = String((error as any).code || (error as any).cause?.code || '');
  return (
    name.includes('NotFound') ||
    code === 'NOT_FOUND' ||
    message.toLowerCase().includes('not found') ||
    message.toLowerCase().includes('no schedule')
  );
}

export async function probeTemporalReadiness(): Promise<TemporalReadiness> {
  const { address, namespace, taskQueue } = temporalConfig();
  const result = await withTemporalClient(async (client) => {
    await withTimeout(client.workflowService.describeNamespace({ namespace }), 4000);

    let workerEvidence: TemporalReadiness['workerEvidence'] = 'unknown';
    try {
      const described: any = await withTimeout(
        client.workflowService.describeTaskQueue({
          namespace,
          taskQueue: { name: taskQueue },
          includeTaskQueueStatus: true,
        }),
        4000
      );
      const pollers = described?.pollers ?? described?.taskQueueStatus?.pollers ?? [];
      workerEvidence = Array.isArray(pollers) && pollers.length > 0 ? 'available' : 'none';
    } catch {
      workerEvidence = 'unknown';
    }

    return { workerEvidence };
  });

  if (!result.ok) {
    const failure = result as { ok: false; error: string };
    return {
      reachable: false,
      address,
      namespace,
      taskQueue,
      workerEvidence: 'unknown',
      error: failure.error,
    };
  }

  return {
    reachable: true,
    address,
    namespace,
    taskQueue,
    workerEvidence: result.value.workerEvidence,
  };
}

/**
 * Describe the tenant's Entra schedule if it exists. Never creates, updates,
 * deletes, or triggers it. Distinguishes a lookup/connectivity failure from a
 * genuinely missing schedule.
 */
export async function describeEntraSchedule(tenant: string): Promise<EntraScheduleDescription> {
  const scheduleId = `${ENTRA_SCHEDULE_ID_PREFIX}:${tenant}`;
  const result = await withTemporalClient(async (client) => {
    const handle = client.schedule.getHandle(scheduleId);
    // The installed @temporalio/client ScheduleDescription exposes `spec`,
    // `state`, and `info` at the top level, and IntervalSpecDescription.every
    // is a number of milliseconds.
    const description: any = await withTimeout(handle.describe() as Promise<any>, 4000);

    const spec = description?.spec ?? description?.schedule?.spec;
    const intervals = spec?.intervals;
    const every = Array.isArray(intervals) && intervals.length > 0 ? intervals[0]?.every : undefined;
    const intervalMinutes = intervalToMinutes(every);

    const state = description?.state ?? description?.schedule?.state;
    const paused = state && typeof state.paused === 'boolean' ? state.paused : null;

    const nextRaw = description?.info?.nextActionTimes?.[0] ?? null;
    const nextFireTime = nextRaw ? new Date(nextRaw).toISOString() : null;

    return { nextFireTime, intervalMinutes, paused };
  });

  if (!result.ok) {
    const failure = result as { ok: false; error: string };
    // A missing schedule throws NotFound; any other failure is a lookup fault.
    return {
      configured: false,
      lookupFailed: !isScheduleNotFound({ message: failure.error }),
      nextFireTime: null,
      intervalMinutes: null,
      paused: null,
      error: failure.error,
    };
  }

  return {
    configured: true,
    lookupFailed: false,
    nextFireTime: result.value.nextFireTime,
    intervalMinutes: result.value.intervalMinutes,
    paused: result.value.paused,
  };
}

/** Accept the SDK's numeric milliseconds or a duration string like `1h`. */
function intervalToMinutes(every: unknown): number | null {
  if (typeof every === 'number' && Number.isFinite(every)) {
    return every / 60_000;
  }
  if (typeof every === 'string') {
    const match = every.trim().match(/^(\d+)\s*(ms|s|m|h|d)$/i);
    if (!match) return null;
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value)) return null;
    if (unit === 'ms') return value / 60_000;
    if (unit === 's') return value / 60;
    if (unit === 'm') return value;
    if (unit === 'h') return value * 60;
    return value * 60 * 24;
  }
  return null;
}
