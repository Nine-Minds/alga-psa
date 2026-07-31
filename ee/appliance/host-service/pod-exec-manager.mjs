import {
  accessError,
  exitCodeFromStatus,
  newAccessId,
  parseShell,
  parseTerminalSize,
  PodAccessError,
  validatePodTarget,
} from './pod-access-common.mjs';
import { podIdentity } from './kubernetes-client-adapter.mjs';

const DEFAULT_IDLE_MS = 30 * 60_000;
const DEFAULT_POD_CHECK_MS = 15_000;
const DEFAULT_MAX_BUFFERED_BYTES = 512 * 1024;
const MAX_CLIENT_MESSAGE_BYTES = 64 * 1024;

function lifecycleLog(logger, event, session, extra = {}) {
  logger.info?.(JSON.stringify({
    component: 'appliance-pod-exec',
    event,
    sessionId: session.id,
    clientAddress: session.clientAddress,
    namespace: session.namespace,
    pod: session.pod,
    container: session.container,
    shell: session.actualShell || session.requestedShell,
    ...extra,
  }));
}

function statusMessage(status) {
  return String(status?.message || status?.reason || status?.status || 'Container shell exited.');
}

export class PodExecManager {
  constructor({
    adapter,
    maxSessions = 4,
    idleMs = DEFAULT_IDLE_MS,
    podCheckMs = DEFAULT_POD_CHECK_MS,
    maxBufferedBytes = DEFAULT_MAX_BUFFERED_BYTES,
    logger = console,
    now = () => Date.now(),
    startTimer = true,
  } = {}) {
    this.adapter = adapter;
    this.maxSessions = maxSessions;
    this.idleMs = idleMs;
    this.maxBufferedBytes = maxBufferedBytes;
    this.logger = logger;
    this.now = now;
    this.sessions = new Map();
    this.sweepRunning = false;
    this.timer = startTimer && podCheckMs > 0
      ? setInterval(() => { this.sweep().catch(() => {}); }, podCheckMs)
      : null;
    this.timer?.unref?.();
  }

  get size() {
    return this.sessions.size;
  }

  async attach(webSocket, rawTarget, { clientAddress = 'unknown' } = {}) {
    if (this.sessions.size >= this.maxSessions) {
      throw new PodAccessError('terminal_limit', `This appliance already has ${this.maxSessions} active terminal sessions.`, 429);
    }
    const target = validatePodTarget(rawTarget);
    const requestedShell = parseShell(rawTarget?.shell);
    const size = parseTerminalSize(rawTarget);
    const pod = await this.adapter.readPod(target.namespace, target.pod);
    const identity = podIdentity(pod);
    if (identity.phase !== 'Running') {
      throw new PodAccessError('pod_not_running', `Pod ${target.namespace}/${target.pod} is not Running.`, 409);
    }
    if (!identity.uid || !identity.containers.includes(target.container)) {
      throw new PodAccessError('container_not_found', `Container ${target.container} is not available in the selected pod.`, 404);
    }

    const session = {
      id: newAccessId('exec'),
      ...target,
      podUid: identity.uid,
      requestedShell,
      shellCandidates: requestedShell === 'auto' ? ['bash', 'sh'] : [requestedShell],
      actualShell: null,
      columns: size.columns,
      rows: size.rows,
      clientAddress,
      webSocket,
      handle: null,
      closed: false,
      generation: 0,
      inputSeen: false,
      outputSeen: false,
      lastActivityAt: this.now(),
      startedAt: this.now(),
    };
    this.sessions.set(session.id, session);

    webSocket.on('message', (data) => this.onClientMessage(session, data));
    webSocket.on('close', () => this.finish(session, 'browser-disconnect', { closeBrowser: false }));
    webSocket.on('error', (error) => this.finish(session, 'browser-error', { message: error?.message, closeBrowser: false }));
    lifecycleLog(this.logger, 'started', session);

    try {
      await this.startNextShell(session);
    } catch (error) {
      const access = accessError(error, 'exec_start_failed');
      this.send(session, { type: 'error', code: access.code, message: access.message });
      this.finish(session, access.code);
    }
    return session.id;
  }

  async startNextShell(session) {
    if (session.closed) return;
    const shell = session.shellCandidates.shift();
    if (!shell) {
      throw new PodAccessError('shell_unavailable', 'This container does not provide bash or sh.', 409);
    }
    const generation = ++session.generation;
    session.actualShell = shell;
    session.inputSeen = false;
    session.outputSeen = false;

    let handle;
    try {
      handle = await this.adapter.openExec({
        namespace: session.namespace,
        pod: session.pod,
        container: session.container,
        shell,
        columns: session.columns,
        rows: session.rows,
        onData: (data) => {
          if (session.closed || generation !== session.generation) return;
          session.outputSeen = true;
          this.touch(session);
          this.send(session, { type: 'output', data });
        },
        onStatus: (status) => {
          if (session.closed || generation !== session.generation) return;
          const code = exitCodeFromStatus(status);
          if (code !== 0 && this.canFallback(session, shell)) {
            this.fallback(session, generation, statusMessage(status));
            return;
          }
          this.send(session, { type: 'exit', code, message: statusMessage(status) });
          this.finish(session, 'shell-exit', { exitCode: code });
        },
        onClose: () => {
          if (session.closed || generation !== session.generation) return;
          if (this.canFallback(session, shell)) {
            this.fallback(session, generation, `${shell} closed before it became interactive.`);
            return;
          }
          this.send(session, { type: 'exit', code: null, message: 'Container shell disconnected.' });
          this.finish(session, 'kubernetes-disconnect');
        },
        onError: (error) => {
          if (session.closed || generation !== session.generation) return;
          if (this.canFallback(session, shell)) {
            this.fallback(session, generation, error?.message);
            return;
          }
          this.send(session, { type: 'error', code: 'exec_stream_failed', message: error?.message || 'Container shell stream failed.' });
          this.finish(session, 'exec-stream-failed');
        },
      });
    } catch (error) {
      if (this.canFallback(session, shell)) {
        lifecycleLog(this.logger, 'shell-fallback', session, { fromShell: shell, reason: error?.message });
        return this.startNextShell(session);
      }
      throw error;
    }

    if (session.closed || generation !== session.generation) {
      handle.close();
      return;
    }
    session.handle?.close?.();
    session.handle = handle;
    this.touch(session);
    this.send(session, { type: 'ready', sessionId: session.id, shell });
  }

  canFallback(session, shell) {
    return session.requestedShell === 'auto'
      && shell === 'bash'
      && session.shellCandidates.length > 0
      && !session.inputSeen
      && !session.outputSeen;
  }

  fallback(session, generation, reason) {
    if (session.closed || generation !== session.generation) return;
    lifecycleLog(this.logger, 'shell-fallback', session, { fromShell: session.actualShell, reason });
    session.handle?.close?.();
    session.handle = null;
    this.startNextShell(session).catch((error) => {
      const access = accessError(error, 'shell_unavailable');
      this.send(session, { type: 'error', code: access.code, message: access.message });
      this.finish(session, access.code);
    });
  }

  onClientMessage(session, raw) {
    if (session.closed) return;
    const byteLength = Buffer.isBuffer(raw) ? raw.length : Buffer.byteLength(String(raw));
    if (byteLength > MAX_CLIENT_MESSAGE_BYTES) {
      this.send(session, { type: 'error', code: 'message_too_large', message: 'Terminal message exceeds 64 KiB.' });
      this.finish(session, 'message-too-large');
      return;
    }
    let message;
    try {
      message = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
    } catch {
      this.send(session, { type: 'error', code: 'invalid_message', message: 'Terminal message must be valid JSON.' });
      return;
    }
    if (message?.type === 'input') {
      if (typeof message.data !== 'string') {
        this.send(session, { type: 'error', code: 'invalid_input', message: 'Terminal input must be text.' });
        return;
      }
      if (!session.handle) return;
      session.inputSeen = true;
      this.touch(session);
      session.handle.write(message.data);
      return;
    }
    if (message?.type === 'resize') {
      try {
        const size = parseTerminalSize(message);
        session.columns = size.columns;
        session.rows = size.rows;
        session.handle?.resize(size.columns, size.rows);
        this.touch(session);
      } catch (error) {
        const access = accessError(error, 'invalid_terminal_size');
        this.send(session, { type: 'error', code: access.code, message: access.message });
      }
      return;
    }
    this.send(session, { type: 'error', code: 'invalid_message', message: 'Unsupported terminal message type.' });
  }

  touch(session) {
    session.lastActivityAt = this.now();
  }

  send(session, message) {
    if (session.closed || session.webSocket.readyState !== 1) return false;
    if (Number(session.webSocket.bufferedAmount || 0) > this.maxBufferedBytes) {
      this.finish(session, 'slow-client');
      return false;
    }
    try {
      session.webSocket.send(JSON.stringify(message));
      return true;
    } catch {
      this.finish(session, 'browser-send-failed', { closeBrowser: false });
      return false;
    }
  }

  async sweep() {
    if (this.sweepRunning) return;
    this.sweepRunning = true;
    try {
      const now = this.now();
      await Promise.all([...this.sessions.values()].map(async (session) => {
        if (session.closed) return;
        if (now - session.lastActivityAt >= this.idleMs) {
          this.send(session, { type: 'error', code: 'idle_timeout', message: 'Terminal closed after 30 minutes without activity.' });
          this.finish(session, 'idle-timeout');
          return;
        }
        try {
          const current = podIdentity(await this.adapter.readPod(session.namespace, session.pod));
          if (current.uid !== session.podUid || current.phase !== 'Running' || !current.containers.includes(session.container)) {
            this.send(session, { type: 'error', code: 'pod_replaced', message: 'The selected pod or container is no longer running.' });
            this.finish(session, 'pod-replaced');
          }
        } catch {
          this.send(session, { type: 'error', code: 'pod_unavailable', message: 'The selected pod is no longer available.' });
          this.finish(session, 'pod-unavailable');
        }
      }));
    } finally {
      this.sweepRunning = false;
    }
  }

  finish(session, reason, { closeBrowser = true, ...extra } = {}) {
    if (!session || session.closed) return;
    session.closed = true;
    session.generation += 1;
    this.sessions.delete(session.id);
    try { session.handle?.close?.(); } catch { /* best effort */ }
    session.handle = null;
    lifecycleLog(this.logger, 'stopped', session, { reason, ...extra });
    if (closeBrowser && session.webSocket.readyState === 1) {
      try { session.webSocket.close(1000, String(reason).slice(0, 120)); } catch { /* best effort */ }
    }
  }

  closeAll(reason = 'control-plane-shutdown') {
    for (const session of [...this.sessions.values()]) this.finish(session, reason);
  }

  shutdown() {
    if (this.timer) clearInterval(this.timer);
    this.closeAll();
  }
}
