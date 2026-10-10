// Native, concurrent Kubernetes reads for the status UI's hot paths.
//
// These used to be `kubectl ... -o json` subprocesses on the shared serial
// command queue: every Overview refresh spawned five shells + kubectl binaries
// (each a cold Go start and a fresh TLS handshake), one after another, and any
// Pods/Logs request waited behind them and behind the Manage view's in-pod
// license exec. On a CPU-starved appliance that made the Overview take seconds
// and the Pods tab feel stuck. Reads now share one client, run concurrently,
// and honour per-call timeouts and request cancellation. Mutations and execs
// stay on the kubectl queue in server.mjs.
//
// Every list returns the same object shapes `kubectl get -o json` prints (the
// typed client's models round-trip through JSON), so consumers see one format.

import { loadKubeConfig } from './kubernetes-client-adapter.mjs';

export const DEFAULT_CLUSTER_READ_TIMEOUT_MS = 15_000;

const FLUX_HELM_GROUP = 'helm.toolkit.fluxcd.io';
const FLUX_HELM_VERSION = 'v2';

const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE']);

function errorCode(error) {
  return error?.code || error?.cause?.code || error?.errno || null;
}

// Classify a client failure into the small set of outcomes the status engine
// reasons about. `reason` is the contract; `error` is for humans.
export function classifyClusterReadError(error, { timedOut = false, cancelled = false } = {}) {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown error');
  if (cancelled) return { ok: false, reason: 'cancelled', status: 499, error: 'Request cancelled by caller.' };
  if (timedOut || error?.name === 'TimeoutError') {
    return { ok: false, reason: 'timeout', status: 124, error: `Kubernetes API request timed out: ${message}` };
  }
  const httpStatus = Number(error?.code);
  if (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus < 600) {
    const reason = httpStatus === 404 ? 'not-found' : (httpStatus === 401 || httpStatus === 403) ? 'forbidden' : 'error';
    return { ok: false, reason, status: httpStatus, error: `Kubernetes API returned HTTP ${httpStatus}: ${bodyMessage(error) || message}` };
  }
  const code = errorCode(error);
  if (UNREACHABLE_CODES.has(code)) {
    return { ok: false, reason: 'unreachable', status: null, error: `Unable to connect to the Kubernetes API (${code}): ${message}` };
  }
  if (code === 'ENOENT') {
    return { ok: false, reason: 'unavailable', status: null, error: `Kubernetes client configuration is not available: ${message}` };
  }
  return { ok: false, reason: 'error', status: null, error: message };
}

function bodyMessage(error) {
  const body = error?.body;
  if (!body) return '';
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    return parsed?.message || '';
  } catch {
    return String(body).slice(0, 300);
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

// Per-call options that attach an AbortSignal to the request. The typed
// clients take observable-style middleware (the shape of client-node's own
// setHeaderMiddleware), built on the library's exported Observable.
function signalOptions(Observable, signal) {
  return {
    middleware: [{
      pre: (context) => { context.setSignal(signal); return new Observable(Promise.resolve(context)); },
      post: (response) => new Observable(Promise.resolve(response))
    }],
    middlewareMergeStrategy: 'append'
  };
}

export function createClusterReader({
  kubeconfigPath,
  moduleLoader = () => import('@kubernetes/client-node'),
  serviceAccountTokenPath,
  defaultTimeoutMs = DEFAULT_CLUSTER_READ_TIMEOUT_MS
} = {}) {
  let clientsPromise = null;

  function clients() {
    if (!clientsPromise) {
      clientsPromise = moduleLoader().then((k8s) => {
        const config = loadKubeConfig(k8s, { kubeconfigPath, serviceAccountTokenPath });
        return {
          Observable: k8s.Observable,
          core: config.makeApiClient(k8s.CoreV1Api),
          apps: config.makeApiClient(k8s.AppsV1Api),
          batch: config.makeApiClient(k8s.BatchV1Api),
          custom: config.makeApiClient(k8s.CustomObjectsApi)
        };
      });
      // A missing kubeconfig early in setup must not poison every later read.
      clientsPromise.catch(() => { clientsPromise = null; });
    }
    return clientsPromise;
  }

  async function read(call, { signal, timeoutMs = defaultTimeoutMs } = {}) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const api = await clients();
      return { ok: true, value: await call(api, signalOptions(api.Observable, combined)) };
    } catch (error) {
      return classifyClusterReadError(error, { timedOut: timeout.aborted, cancelled: Boolean(signal?.aborted) && !timeout.aborted });
    }
  }

  async function list(call, options) {
    const result = await read(call, options);
    if (!result.ok) return result;
    return { ok: true, items: plain(result.value)?.items || [] };
  }

  return {
    listNodes: (options) => list((api, o) => api.core.listNode({}, o), options),
    listNamespaces: (options) => list((api, o) => api.core.listNamespace({}, o), options),
    listPods: ({ namespace, ...options } = {}) => list((api, o) => (namespace
      ? api.core.listNamespacedPod({ namespace }, o)
      : api.core.listPodForAllNamespaces({}, o)), options),
    listJobs: ({ namespace, ...options } = {}) => list((api, o) => (namespace
      ? api.batch.listNamespacedJob({ namespace }, o)
      : api.batch.listJobForAllNamespaces({}, o)), options),
    listDeployments: ({ namespace, ...options } = {}) => list((api, o) => (namespace
      ? api.apps.listNamespacedDeployment({ namespace }, o)
      : api.apps.listDeploymentForAllNamespaces({}, o)), options),
    listReplicaSets: ({ namespace, ...options } = {}) => list((api, o) => (namespace
      ? api.apps.listNamespacedReplicaSet({ namespace }, o)
      : api.apps.listReplicaSetForAllNamespaces({}, o)), options),
    listStatefulSets: ({ namespace, ...options } = {}) => list((api, o) => (namespace
      ? api.apps.listNamespacedStatefulSet({ namespace }, o)
      : api.apps.listStatefulSetForAllNamespaces({}, o)), options),
    listDaemonSets: ({ namespace, ...options } = {}) => list((api, o) => (namespace
      ? api.apps.listNamespacedDaemonSet({ namespace }, o)
      : api.apps.listDaemonSetForAllNamespaces({}, o)), options),
    listEvents: (options) => list((api, o) => api.core.listEventForAllNamespaces({}, o), options),
    listHelmReleases: ({ namespace, ...options } = {}) => list((api, o) => api.custom.listNamespacedCustomObject({
      group: FLUX_HELM_GROUP,
      version: FLUX_HELM_VERSION,
      namespace,
      plural: 'helmreleases'
    }, o), options),
    async readPodLog({ namespace, pod, container, tailLines, previous, ...options }) {
      const result = await read((api, o) => api.core.readNamespacedPodLog({
        namespace,
        name: pod,
        ...(container ? { container } : {}),
        ...(tailLines ? { tailLines } : {}),
        ...(previous ? { previous: true } : {})
      }, o), options);
      if (!result.ok) return result;
      return { ok: true, text: typeof result.value === 'string' ? result.value : String(result.value ?? '') };
    }
  };
}
