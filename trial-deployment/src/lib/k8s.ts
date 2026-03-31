import * as k8s from '@kubernetes/client-node';
import { getTrialConfig } from './config';

let _kubeConfig: k8s.KubeConfig | null = null;

export function getKubeConfig(): k8s.KubeConfig {
  if (!_kubeConfig) {
    _kubeConfig = new k8s.KubeConfig();

    if (process.env.KUBECONFIG) {
      _kubeConfig.loadFromFile(process.env.KUBECONFIG);
    } else {
      // In-cluster when running as a pod, or default kubeconfig
      try {
        _kubeConfig.loadFromCluster();
      } catch {
        _kubeConfig.loadFromDefault();
      }
    }

    const config = getTrialConfig();
    if (config.kubeContext) {
      _kubeConfig.setCurrentContext(config.kubeContext);
    }
  }
  return _kubeConfig;
}

export function getCoreApi(): k8s.CoreV1Api {
  return getKubeConfig().makeApiClient(k8s.CoreV1Api);
}

export function getAppsApi(): k8s.AppsV1Api {
  return getKubeConfig().makeApiClient(k8s.AppsV1Api);
}

export function getBatchApi(): k8s.BatchV1Api {
  return getKubeConfig().makeApiClient(k8s.BatchV1Api);
}

/**
 * Create a Kubernetes namespace for a trial instance.
 */
export async function createNamespace(name: string): Promise<void> {
  const api = getCoreApi();
  await api.createNamespace({
    body: {
      metadata: {
        name,
        labels: {
          'app.kubernetes.io/managed-by': 'alga-trial-deployer',
          'alga-psa/trial': 'true',
        },
      },
    },
  });
}

/**
 * Delete a trial namespace (cascades all resources within it).
 */
export async function deleteNamespace(name: string): Promise<void> {
  const api = getCoreApi();
  await api.deleteNamespace({ name });
}

/**
 * Create the db-credentials Kubernetes secret in the trial namespace.
 */
export async function createDbCredentialsSecret(
  namespace: string,
  passwords: {
    superuser: string;
    server: string;
    hocuspocus: string;
    pgbouncer?: string;
  }
): Promise<void> {
  const api = getCoreApi();
  await api.createNamespacedSecret({
    namespace,
    body: {
      metadata: {
        name: 'db-credentials',
        namespace,
      },
      type: 'Opaque',
      stringData: {
        DB_PASSWORD_SUPERUSER: passwords.superuser,
        DB_PASSWORD_SERVER: passwords.server,
        DB_PASSWORD_HOCUSPOCUS: passwords.hocuspocus,
        DB_PASSWORD_PGBOUNCER: passwords.pgbouncer || passwords.server,
      },
    },
  });
}

/**
 * Create a generic secret in the trial namespace.
 */
export async function createSecret(
  namespace: string,
  name: string,
  data: Record<string, string>
): Promise<void> {
  const api = getCoreApi();
  await api.createNamespacedSecret({
    namespace,
    body: {
      metadata: { name, namespace },
      type: 'Opaque',
      stringData: data,
    },
  });
}

/**
 * Wait for all pods in a namespace to be ready (with a timeout).
 */
export async function waitForPodsReady(
  namespace: string,
  timeoutMs: number = 300_000
): Promise<boolean> {
  const api = getCoreApi();
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { items: pods } = await api.listNamespacedPod({ namespace });

    // Filter to long-running pods (skip completed Jobs)
    const runningPods = pods.filter(
      p => p.status?.phase !== 'Succeeded' && p.status?.phase !== 'Failed'
    );

    if (runningPods.length > 0) {
      const allReady = runningPods.every(pod => {
        const conditions = pod.status?.conditions || [];
        return conditions.some(c => c.type === 'Ready' && c.status === 'True');
      });

      if (allReady) return true;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  return false;
}

/**
 * Wait for a Job to complete in the namespace.
 */
export async function waitForJobComplete(
  namespace: string,
  jobNamePrefix: string,
  timeoutMs: number = 300_000
): Promise<boolean> {
  const api = getBatchApi();
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { items: jobs } = await api.listNamespacedJob({ namespace });
    const job = jobs.find(j => j.metadata?.name?.startsWith(jobNamePrefix));

    if (job) {
      if (job.status?.succeeded && job.status.succeeded > 0) return true;
      if (job.status?.failed && job.status.failed > (job.spec?.backoffLimit ?? 2)) return false;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  return false;
}

/**
 * Check if a namespace exists.
 */
export async function namespaceExists(name: string): Promise<boolean> {
  const api = getCoreApi();
  try {
    await api.readNamespace({ name });
    return true;
  } catch {
    return false;
  }
}
