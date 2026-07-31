import net from 'node:net';
import {
  accessError,
  newAccessId,
  normalizeApplianceAddress,
  parseDurationMinutes,
  parseTcpPort,
  PodAccessError,
  validatePodTarget,
} from './pod-access-common.mjs';
import { podIdentity } from './kubernetes-client-adapter.mjs';

const DEFAULT_POD_CHECK_MS = 15_000;
const DEFAULT_RANDOM_MIN = 20_000;
const DEFAULT_RANDOM_MAX = 45_000;
const RANDOM_PORT_ATTEMPTS = 32;
const RESERVED_LOCAL_PORTS = new Set([22, 80, 443, 3000, 6443, 8080]);

function lifecycleLog(logger, event, forward, extra = {}) {
  logger.info?.(JSON.stringify({
    component: 'appliance-port-forward',
    event,
    forwardId: forward.id,
    clientAddress: forward.clientAddress,
    namespace: forward.namespace,
    pod: forward.pod,
    container: forward.container,
    bindAddress: forward.bindAddress,
    localPort: forward.localPort,
    remotePort: forward.remotePort,
    ...extra,
  }));
}

function listen(server, port, address) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, address);
  });
}

function asPublicForward(forward) {
  return {
    id: forward.id,
    namespace: forward.namespace,
    pod: forward.pod,
    container: forward.container,
    bindAddress: forward.bindAddress,
    localPort: forward.localPort,
    remotePort: forward.remotePort,
    address: `${forward.bindAddress}:${forward.localPort}`,
    state: forward.closed ? 'stopped' : 'active',
    activeConnections: forward.connections.size,
    createdAt: new Date(forward.createdAt).toISOString(),
    expiresAt: new Date(forward.expiresAt).toISOString(),
  };
}

export class PortForwardManager {
  constructor({
    adapter,
    maxForwards = 16,
    podCheckMs = DEFAULT_POD_CHECK_MS,
    randomPortMin = Number(process.env.ALGA_APPLIANCE_FORWARD_PORT_MIN || DEFAULT_RANDOM_MIN),
    randomPortMax = Number(process.env.ALGA_APPLIANCE_FORWARD_PORT_MAX || DEFAULT_RANDOM_MAX),
    serverFactory = (handler) => net.createServer(handler),
    random = Math.random,
    logger = console,
    now = () => Date.now(),
    startTimer = true,
  } = {}) {
    this.adapter = adapter;
    this.maxForwards = maxForwards;
    this.randomPortMin = randomPortMin;
    this.randomPortMax = randomPortMax;
    this.serverFactory = serverFactory;
    this.random = random;
    this.logger = logger;
    this.now = now;
    this.forwards = new Map();
    this.sweepRunning = false;
    this.timer = startTimer && podCheckMs > 0
      ? setInterval(() => { this.sweep().catch(() => {}); }, podCheckMs)
      : null;
    this.timer?.unref?.();
  }

  get size() {
    return this.forwards.size;
  }

  list() {
    return [...this.forwards.values()]
      .map(asPublicForward)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async create(raw, { bindAddress, clientAddress = 'unknown' } = {}) {
    if (this.forwards.size >= this.maxForwards) {
      throw new PodAccessError('forward_limit', `This appliance already has ${this.maxForwards} active port forwards.`, 429);
    }
    const target = validatePodTarget(raw);
    const remotePort = parseTcpPort(raw?.remotePort);
    const requestedLocalPort = parseTcpPort(raw?.localPort, { optional: true });
    const durationMinutes = parseDurationMinutes(raw?.durationMinutes);
    const normalizedAddress = normalizeApplianceAddress(bindAddress);
    if (requestedLocalPort !== null && (requestedLocalPort < 1024 || RESERVED_LOCAL_PORTS.has(requestedLocalPort))) {
      throw new PodAccessError('reserved_port', 'Choose an appliance-side port from 1024 through 65535 that is not reserved by the appliance.', 400);
    }

    const pod = await this.adapter.readPod(target.namespace, target.pod);
    const identity = podIdentity(pod);
    if (identity.phase !== 'Running') {
      throw new PodAccessError('pod_not_running', `Pod ${target.namespace}/${target.pod} is not Running.`, 409);
    }
    if (!identity.uid || !identity.containers.includes(target.container)) {
      throw new PodAccessError('container_not_found', `Container ${target.container} is not available in the selected pod.`, 404);
    }

    const forward = {
      id: newAccessId('forward'),
      ...target,
      podUid: identity.uid,
      remotePort,
      localPort: null,
      bindAddress: normalizedAddress,
      clientAddress,
      durationMinutes,
      createdAt: this.now(),
      expiresAt: this.now() + durationMinutes * 60_000,
      server: null,
      connections: new Set(),
      expiryTimer: null,
      closed: false,
    };

    const ports = requestedLocalPort === null
      ? Array.from({ length: RANDOM_PORT_ATTEMPTS }, () => this.randomPort())
      : [requestedLocalPort];
    let lastError;
    for (const candidate of ports) {
      const server = this.serverFactory((socket) => this.acceptConnection(forward, socket));
      try {
        await listen(server, candidate, normalizedAddress);
        forward.server = server;
        forward.localPort = candidate;
        server.on('error', (error) => {
          lifecycleLog(this.logger, 'listener-error', forward, { reason: error?.message });
          this.stop(forward.id, 'listener-error');
        });
        break;
      } catch (error) {
        lastError = error;
        try { server.close(); } catch { /* not listening */ }
        if (requestedLocalPort !== null || error?.code !== 'EADDRINUSE') break;
      }
    }
    if (!forward.server) {
      if (lastError?.code === 'EADDRINUSE') {
        throw new PodAccessError('port_in_use', 'The requested appliance-side port is already in use.', 409);
      }
      throw accessError(lastError, 'listener_failed');
    }

    this.forwards.set(forward.id, forward);
    this.scheduleExpiry(forward);
    lifecycleLog(this.logger, 'started', forward, { expiresAt: new Date(forward.expiresAt).toISOString() });
    return asPublicForward(forward);
  }

  randomPort() {
    const span = this.randomPortMax - this.randomPortMin + 1;
    if (!Number.isInteger(span) || span < 1) {
      throw new PodAccessError('invalid_port_range', 'The appliance random port range is invalid.', 500);
    }
    return this.randomPortMin + Math.floor(this.random() * span);
  }

  async acceptConnection(forward, socket) {
    if (forward.closed) {
      socket.destroy();
      return;
    }
    const connection = { socket, tunnel: null, closed: false };
    forward.connections.add(connection);
    const closeConnection = () => {
      if (connection.closed) return;
      connection.closed = true;
      forward.connections.delete(connection);
      try { connection.tunnel?.close?.(); } catch { /* best effort */ }
      connection.tunnel = null;
      try { socket.destroy(); } catch { /* best effort */ }
    };
    socket.on('close', closeConnection);
    socket.on('error', closeConnection);
    try {
      const tunnel = await this.adapter.openPortForward({
        namespace: forward.namespace,
        pod: forward.pod,
        remotePort: forward.remotePort,
        socket,
        onError: (error) => {
          lifecycleLog(this.logger, 'connection-error', forward, { reason: error?.message });
          closeConnection();
        },
        onClose: closeConnection,
      });
      if (connection.closed || forward.closed) {
        try { tunnel?.close?.(); } catch { /* best effort */ }
        return;
      }
      connection.tunnel = tunnel;
    } catch (error) {
      lifecycleLog(this.logger, 'connection-error', forward, { reason: error?.message });
      closeConnection();
    }
  }

  extend(id, rawDuration) {
    const forward = this.forwards.get(id);
    if (!forward || forward.closed) throw new PodAccessError('forward_not_found', 'Port forward was not found.', 404);
    const durationMinutes = parseDurationMinutes(rawDuration);
    forward.durationMinutes = durationMinutes;
    forward.expiresAt = this.now() + durationMinutes * 60_000;
    this.scheduleExpiry(forward);
    lifecycleLog(this.logger, 'extended', forward, { expiresAt: new Date(forward.expiresAt).toISOString() });
    return asPublicForward(forward);
  }

  stop(id, reason = 'manual-stop') {
    const forward = this.forwards.get(id);
    if (!forward || forward.closed) return false;
    forward.closed = true;
    this.forwards.delete(id);
    if (forward.expiryTimer) clearTimeout(forward.expiryTimer);
    forward.expiryTimer = null;
    try { forward.server?.close(); } catch { /* best effort */ }
    forward.server = null;
    for (const connection of [...forward.connections]) {
      connection.closed = true;
      try { connection.tunnel?.close?.(); } catch { /* best effort */ }
      try { connection.socket.destroy(); } catch { /* best effort */ }
      forward.connections.delete(connection);
    }
    lifecycleLog(this.logger, 'stopped', forward, { reason });
    return true;
  }

  scheduleExpiry(forward) {
    if (forward.expiryTimer) clearTimeout(forward.expiryTimer);
    forward.expiryTimer = setTimeout(
      () => this.stop(forward.id, 'expired'),
      Math.max(0, forward.expiresAt - this.now()),
    );
    forward.expiryTimer.unref?.();
  }

  async sweep() {
    if (this.sweepRunning) return;
    this.sweepRunning = true;
    try {
      const now = this.now();
      await Promise.all([...this.forwards.values()].map(async (forward) => {
        if (forward.closed) return;
        if (now >= forward.expiresAt) {
          this.stop(forward.id, 'expired');
          return;
        }
        try {
          const current = podIdentity(await this.adapter.readPod(forward.namespace, forward.pod));
          if (current.uid !== forward.podUid || current.phase !== 'Running' || !current.containers.includes(forward.container)) {
            this.stop(forward.id, 'pod-replaced');
          }
        } catch {
          this.stop(forward.id, 'pod-unavailable');
        }
      }));
    } finally {
      this.sweepRunning = false;
    }
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
    for (const id of [...this.forwards.keys()]) this.stop(id, 'control-plane-shutdown');
  }
}
