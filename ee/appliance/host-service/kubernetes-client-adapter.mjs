import { PassThrough, Writable } from 'node:stream';

class ResizableOutput extends Writable {
  constructor({ columns, rows, onData }) {
    super();
    this.columns = columns;
    this.rows = rows;
    this.onData = onData;
  }

  _write(chunk, _encoding, callback) {
    try {
      this.onData(chunk.toString('utf8'));
      callback();
    } catch (error) {
      callback(error);
    }
  }

  resize(columns, rows) {
    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }
}

function closeWebSocket(candidate) {
  const socket = typeof candidate === 'function' ? candidate() : candidate;
  if (!socket) return;
  try { socket.close(); } catch { /* already closed */ }
}

export function createNativeKubernetesAdapter({
  kubeconfigPath,
  moduleLoader = () => import('@kubernetes/client-node'),
} = {}) {
  let clientsPromise;

  async function clients() {
    if (!clientsPromise) {
      clientsPromise = moduleLoader().then((k8s) => {
        const config = new k8s.KubeConfig();
        config.loadFromFile(kubeconfigPath);
        return {
          config,
          core: config.makeApiClient(k8s.CoreV1Api),
          rbac: config.makeApiClient(k8s.RbacAuthorizationV1Api),
          authorization: config.makeApiClient(k8s.AuthorizationV1Api),
          Exec: k8s.Exec,
          PortForward: k8s.PortForward,
        };
      });
    }
    return clientsPromise;
  }

  return {
    async readPod(namespace, pod) {
      const { core } = await clients();
      return core.readNamespacedPod({ namespace, name: pod });
    },

    async readClusterRole(name) {
      const { rbac } = await clients();
      return rbac.readClusterRole({ name });
    },

    async replaceClusterRole(name, body) {
      const { rbac } = await clients();
      return rbac.replaceClusterRole({ name, body });
    },

    async canCreatePodSubresource(subresource) {
      const { authorization } = await clients();
      const review = await authorization.createSelfSubjectAccessReview({
        body: {
          apiVersion: 'authorization.k8s.io/v1',
          kind: 'SelfSubjectAccessReview',
          spec: {
            resourceAttributes: {
              group: '',
              resource: 'pods',
              subresource,
              verb: 'create',
            },
          },
        },
      });
      return review?.status?.allowed === true;
    },

    async openExec({ namespace, pod, container, shell, columns, rows, onData, onStatus, onClose, onError }) {
      const { config, Exec } = await clients();
      const input = new PassThrough();
      const output = new ResizableOutput({ columns, rows, onData });
      const exec = new Exec(config);
      const socket = await exec.exec(
        namespace,
        pod,
        container,
        [shell],
        output,
        output,
        input,
        true,
        onStatus,
      );
      socket.on?.('close', onClose);
      socket.on?.('error', onError);
      return {
        write(data) { input.write(data); },
        resize(nextColumns, nextRows) { output.resize(nextColumns, nextRows); },
        close() {
          try { input.end(); } catch { /* already ended */ }
          closeWebSocket(socket);
          try { output.end(); } catch { /* already ended */ }
        },
      };
    },

    async openPortForward({ namespace, pod, remotePort, socket, onError, onClose }) {
      const { config, PortForward } = await clients();
      const errorOutput = new Writable({
        write(chunk, _encoding, callback) {
          const message = chunk.toString('utf8').trim();
          if (message) onError(new Error(message));
          callback();
        },
      });
      const forwarder = new PortForward(config);
      const tunnel = await forwarder.portForward(
        namespace,
        pod,
        [remotePort],
        socket,
        errorOutput,
        socket,
      );
      const activeSocket = typeof tunnel === 'function' ? tunnel() : tunnel;
      activeSocket?.on?.('close', onClose);
      activeSocket?.on?.('error', onError);
      return {
        close() {
          closeWebSocket(tunnel);
          try { socket.destroy(); } catch { /* already closed */ }
        },
      };
    },
  };
}

export function podIdentity(pod) {
  return {
    uid: String(pod?.metadata?.uid || ''),
    phase: String(pod?.status?.phase || ''),
    containers: (pod?.spec?.containers || []).map((container) => String(container.name || '')),
  };
}
