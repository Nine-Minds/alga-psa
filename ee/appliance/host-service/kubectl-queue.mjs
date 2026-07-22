import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

function truncationMarker(limit) {
  return `\n... output truncated at ${limit} bytes ...`;
}

export class SerialCommandQueue {
  constructor({ name = 'command-queue' } = {}) {
    this.name = name;
    this.queue = [];
    this.active = null;
    this.sequence = 0;
  }

  get size() {
    return this.queue.length + (this.active ? 1 : 0);
  }

  enqueue(command, options = {}) {
    const entry = {
      id: ++this.sequence,
      command,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES,
      onStart: options.onStart,
      onDone: options.onDone,
      signal: options.signal,
      stdin: options.stdin,
      queuedAt: Date.now()
    };

    return new Promise((resolve) => {
      entry.resolve = resolve;
      if (entry.signal?.aborted) {
        entry.resolve({ ok: false, status: 499, command, stdout: '', stderr: 'Command cancelled before start.', queuedMs: 0, durationMs: 0, queue: this.name, id: entry.id });
        return;
      }
      this.queue.push(entry);
      this.drain();
    });
  }

  drain() {
    if (this.active) return;
    while (this.queue.length > 0) {
      const entry = this.queue.shift();
      if (entry.signal?.aborted) {
        const result = { ok: false, status: 499, command: entry.command, stdout: '', stderr: 'Command cancelled before start.', queuedMs: Date.now() - entry.queuedAt, durationMs: 0, queue: this.name, id: entry.id };
        try { entry.onDone?.(result); } catch { /* callback best effort */ }
        entry.resolve(result);
        continue;
      }
      this.active = entry;
      this.run(entry);
      return;
    }
  }

  run(entry) {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;
    let killTimer = null;

    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (entry.signal) entry.signal.removeEventListener('abort', cancel);

      const cancelled = entry.signal?.aborted && !timedOut;
      const stderrText = timedOut ? `${stderr}\nCommand timed out after ${entry.timeoutMs}ms.` : (error ? `${stderr}\n${error.message || String(error)}` : stderr);
      const result = {
        ok: status === 0 && !timedOut && !error && !cancelled,
        status: cancelled ? 499 : timedOut ? 124 : (status ?? 1),
        command: entry.command,
        stdout: stdoutTruncated ? `${stdout}${truncationMarker(entry.maxOutputBytes)}` : stdout,
        stderr: stderrTruncated ? `${stderrText}${truncationMarker(entry.maxOutputBytes)}` : stderrText,
        stdoutTruncated,
        stderrTruncated,
        queuedMs: startedAt - entry.queuedAt,
        durationMs: Date.now() - startedAt,
        queue: this.name,
        id: entry.id
      };

      try { entry.onDone?.(result); } catch { /* callback best effort */ }
      entry.resolve(result);
      this.active = null;
      this.drain();
    };

    try { entry.onStart?.({ id: entry.id, command: entry.command, queuedMs: startedAt - entry.queuedAt, queue: this.name }); } catch { /* callback best effort */ }

    const child = spawn('sh', ['-c', entry.command], {
      env: process.env,
      stdio: [entry.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      detached: true
    });
    if (entry.stdin !== undefined) child.stdin.end(String(entry.stdin));

    const killProcessGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };

    const cancel = () => {
      if (settled) return;
      timedOut = false;
      stderr += '\nCommand cancelled by caller.';
      killProcessGroup('SIGTERM');
      killTimer = setTimeout(() => killProcessGroup('SIGKILL'), 2_000);
    };

    if (entry.signal?.aborted) {
      cancel();
    } else if (entry.signal) {
      entry.signal.addEventListener('abort', cancel, { once: true });
    }

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killProcessGroup('SIGTERM');
      killTimer = setTimeout(() => killProcessGroup('SIGKILL'), 2_000);
    }, entry.timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdoutTruncated) return;
      stdout += chunk.toString('utf8');
      if (stdout.length > entry.maxOutputBytes) {
        stdout = stdout.slice(0, entry.maxOutputBytes);
        stdoutTruncated = true;
      }
    });
    child.stderr.on('data', (chunk) => {
      if (stderrTruncated) return;
      stderr += chunk.toString('utf8');
      if (stderr.length > entry.maxOutputBytes) {
        stderr = stderr.slice(0, entry.maxOutputBytes);
        stderrTruncated = true;
      }
    });
    child.on('error', (error) => finish(1, error));
    child.on('close', (code, signal) => finish(code ?? (signal ? 1 : 0)));
  }
}

export function createKubectlQueue(options = {}) {
  return new SerialCommandQueue({ name: options.name || 'kubectl' });
}
