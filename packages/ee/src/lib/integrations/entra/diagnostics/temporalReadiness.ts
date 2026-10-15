/**
 * Community builds ship no Temporal worker to describe, so the readiness probe
 * can neither confirm nor deny a poller. Callers treat `unknown` as "keep
 * waiting", which is the only honest answer here.
 */
export interface TemporalReadiness {
  reachable: boolean;
  address: string;
  namespace: string;
  taskQueue: string;
  workerEvidence: 'available' | 'none' | 'unknown';
  error?: string;
}

export async function probeTemporalReadiness(): Promise<TemporalReadiness> {
  return {
    reachable: false,
    address: '',
    namespace: '',
    taskQueue: '',
    workerEvidence: 'unknown',
    error: 'Temporal diagnostics are not available in this edition.',
  };
}
