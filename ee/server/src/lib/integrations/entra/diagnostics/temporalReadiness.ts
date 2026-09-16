/**
 * Read-only Temporal readiness checks for diagnostics.
 *
 * These deliberately never start a workflow or mutate a schedule. A reachable
 * frontend proves the API answered; it does not prove a worker is polling, so
 * worker evidence is reported as unknown rather than asserted.
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
  workerEvidence: 'unknown' | 'available';
  error?: string;
}

export interface EntraScheduleDescription {
  configured: boolean;
  nextFireTime: string | null;
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
        timer = setTimeout(() => reject(new Error('Temporal connection timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function connectTemporal(): Promise<any | null> {
  const mod: any = await import('@temporalio/client').catch(() => null);
  if (!mod) return null;
  const { address, namespace } = temporalConfig();
  const connection = await withTimeout(mod.Connection.connect({ address }), 4000);
  const client = new mod.Client({ connection, namespace });
  return { mod, connection, client };
}

export async function probeTemporalReadiness(): Promise<TemporalReadiness> {
  const { address, namespace, taskQueue } = temporalConfig();
  try {
    const connected = await connectTemporal();
    if (!connected) {
      return {
        reachable: false,
        address,
        namespace,
        taskQueue,
        workerEvidence: 'unknown',
        error: 'Temporal client is not available in this deployment.',
      };
    }
    await withTimeout(
      connected.client.workflowService.describeNamespace({ namespace }),
      4000
    );
    try {
      connected.connection.close?.();
    } catch {
      // best-effort
    }
    return {
      reachable: true,
      address,
      namespace,
      taskQueue,
      workerEvidence: 'unknown',
    };
  } catch (error: any) {
    return {
      reachable: false,
      address,
      namespace,
      taskQueue,
      workerEvidence: 'unknown',
      error: error?.message || 'Temporal frontend is unreachable.',
    };
  }
}

/**
 * Describe the tenant's Entra schedule if it exists. Never creates, updates,
 * deletes, or triggers it. `nextFireTime` is null when unavailable.
 */
export async function describeEntraSchedule(tenant: string): Promise<EntraScheduleDescription> {
  try {
    const connected = await connectTemporal();
    if (!connected) return { configured: false, nextFireTime: null };
    const scheduleId = `${ENTRA_SCHEDULE_ID_PREFIX}:${tenant}`;
    const handle = connected.client.schedule.getHandle(scheduleId);
    const description: any = await withTimeout(handle.describe() as Promise<any>, 4000);
    const next =
      description?.info?.nextActionTimes?.[0] ??
      description?.info?.nextActionTimes?.[0]?.toISOString?.() ??
      null;
    try {
      connected.connection.close?.();
    } catch {
      // best-effort
    }
    return {
      configured: true,
      nextFireTime: next ? new Date(next).toISOString() : null,
    };
  } catch {
    return { configured: false, nextFireTime: null };
  }
}
