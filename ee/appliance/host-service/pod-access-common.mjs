import crypto from 'node:crypto';
import net from 'node:net';

export const ALLOWED_SHELLS = new Set(['auto', 'bash', 'sh']);
export const ALLOWED_DURATIONS_MINUTES = new Set([30, 60, 240, 480]);

export function validKubernetesName(value) {
  return typeof value === 'string'
    && value.length <= 253
    && /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/.test(value);
}

export function validContainerName(value) {
  return typeof value === 'string'
    && value.length <= 253
    && /^[A-Za-z0-9_.-]+$/.test(value);
}

export function parseTcpPort(value, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PodAccessError('invalid_port', 'Port must be an integer from 1 through 65535.', 400);
  }
  return port;
}

export function parseDurationMinutes(value) {
  const duration = Number(value ?? 30);
  if (!ALLOWED_DURATIONS_MINUTES.has(duration)) {
    throw new PodAccessError('invalid_duration', 'Duration must be 30, 60, 240, or 480 minutes.', 400);
  }
  return duration;
}

export function validatePodTarget(value, { requireContainer = true } = {}) {
  const namespace = String(value?.namespace || '');
  const pod = String(value?.pod || '');
  const container = String(value?.container || '');
  if (!validKubernetesName(namespace) || !validKubernetesName(pod)) {
    throw new PodAccessError('invalid_target', 'Namespace and pod must be valid Kubernetes names.', 400);
  }
  if (requireContainer && !validContainerName(container)) {
    throw new PodAccessError('invalid_target', 'Container must be selected.', 400);
  }
  return { namespace, pod, container };
}

export function parseShell(value) {
  const shell = String(value || 'auto').toLowerCase();
  if (!ALLOWED_SHELLS.has(shell)) {
    throw new PodAccessError('invalid_shell', 'Shell must be Auto, bash, or sh.', 400);
  }
  return shell;
}

export function parseTerminalSize(value = {}) {
  const columns = Number(value.columns ?? value.cols ?? 100);
  const rows = Number(value.rows ?? 30);
  if (!Number.isInteger(columns) || columns < 20 || columns > 500
    || !Number.isInteger(rows) || rows < 5 || rows > 300) {
    throw new PodAccessError('invalid_terminal_size', 'Terminal size is outside the supported range.', 400);
  }
  return { columns, rows };
}

export function requestHasSameOrigin(req) {
  const origin = String(req.headers?.origin || '');
  const host = String(req.headers?.host || '');
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
  } catch {
    return false;
  }
}

export function normalizeApplianceAddress(value) {
  let address = String(value || '');
  if (address.startsWith('::ffff:')) address = address.slice(7);
  if (!net.isIPv4(address) || address.startsWith('127.')) {
    throw new PodAccessError(
      'invalid_bind_address',
      'Open the management UI through the appliance IPv4 LAN address before starting a port forward.',
      400,
    );
  }
  return address;
}

export function newAccessId(prefix) {
  return `${prefix}-${crypto.randomBytes(10).toString('hex')}`;
}

export function exitCodeFromStatus(status) {
  for (const cause of status?.details?.causes || []) {
    if (cause?.reason === 'ExitCode' && Number.isInteger(Number(cause.message))) return Number(cause.message);
  }
  return status?.status === 'Success' ? 0 : null;
}

export class PodAccessError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'PodAccessError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function accessError(error, fallbackCode = 'pod_access_failed') {
  if (error instanceof PodAccessError) return error;
  const message = error instanceof Error ? error.message : String(error || 'Pod access failed.');
  return new PodAccessError(fallbackCode, message, 502);
}
