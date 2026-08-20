import path from 'node:path';

export const SUPPORT_NAMESPACE = 'alga-appliance-support';
export const SUPPORT_AGENT_REPOSITORY = 'ghcr.io/nine-minds/alga-appliance-support-agent';
export const SUPPORT_RECORDING_ROOT = '/var/lib/alga-appliance/support-sessions/history';

const DIGEST_IMAGE_RE = /^ghcr\.io\/nine-minds\/alga-appliance-support-agent@sha256:[a-f0-9]{64}$/;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupportKubernetesError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'SupportKubernetesError';
    this.code = code;
    this.status = status;
  }
}

export function isValidSupportAgentImage(value) {
  return typeof value === 'string' && DIGEST_IMAGE_RE.test(value.trim());
}

export function requireSupportSessionId(value) {
  const id = String(value || '').trim();
  if (!SESSION_ID_RE.test(id)) throw new SupportKubernetesError('invalid_session_id', 'Support session ID is invalid.', 400);
  return id;
}

function safeName(id) {
  return `support-${id}`;
}

export function supportResourceNames(sessionId) {
  const id = requireSupportSessionId(sessionId);
  return {
    namespace: SUPPORT_NAMESPACE,
    pod: safeName(id),
    secret: `${safeName(id)}-connector`,
  };
}

export function buildSupportConnectorSecret({ sessionId, connectorToken }) {
  const id = requireSupportSessionId(sessionId);
  if (typeof connectorToken !== 'string' || connectorToken.length < 16 || connectorToken.length > 4096) {
    throw new SupportKubernetesError('invalid_connector_token', 'Connector token is invalid.', 400);
  }
  const names = supportResourceNames(id);
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: names.secret,
      namespace: SUPPORT_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'alga-appliance-support-agent',
        'alga.nineminds.com/support-session': id,
      },
    },
    type: 'Opaque',
    immutable: true,
    stringData: { 'connector-token': connectorToken },
  };
}

export function buildSupportPod({ session, supportAgentImage, nowMs = Date.now(), resourceRequests = { cpu: '50m', memory: '64Mi' }, resourceLimits = { cpu: '500m', memory: '256Mi' } }) {
  if (!isValidSupportAgentImage(supportAgentImage)) {
    throw new SupportKubernetesError('support_image_unavailable', 'The selected release does not contain a valid support-agent digest.', 412);
  }
  const id = requireSupportSessionId(session?.sessionId);
  const expiresAt = Date.parse(session?.expiresAt || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) throw new SupportKubernetesError('expired', 'Support session has expired.', 409);
  const activeDeadlineSeconds = Math.max(1, Math.ceil((expiresAt - nowMs) / 1000));
  const names = supportResourceNames(id);
  const recordingHostPath = path.posix.join(SUPPORT_RECORDING_ROOT, id);
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: names.pod,
      namespace: SUPPORT_NAMESPACE,
      labels: {
        'app.kubernetes.io/name': 'alga-appliance-support-agent',
        'alga.nineminds.com/support-session': id,
        'alga.nineminds.com/session-state': 'active',
      },
    },
    spec: {
      restartPolicy: 'OnFailure',
      activeDeadlineSeconds,
      automountServiceAccountToken: false,
      hostPID: true,
      securityContext: { seccompProfile: { type: 'Unconfined' } },
      containers: [{
        name: 'support-agent',
        image: supportAgentImage,
        imagePullPolicy: 'IfNotPresent',
        env: [
          { name: 'SUPPORT_SESSION_ID', value: id },
          { name: 'SUPPORT_RELAY_URL', value: String(session.relayUrl) },
          { name: 'SUPPORT_CONNECTOR_TOKEN_FILE', value: '/run/support-connector/connector-token' },
          { name: 'SUPPORT_RECONNECT_TOKEN_FILE', value: '/run/support-reconnect/token' },
          // RecordingSegment appends the session ID. Pass the history parent,
          // while the hostPath mount remains session-scoped.
          { name: 'SUPPORT_RECORDING_DIR', value: `/host${SUPPORT_RECORDING_ROOT}` },
          { name: 'SUPPORT_EXPIRES_AT', value: session.expiresAt },
          { name: 'SUPPORT_RESUMED', value: session.connectorState === 'resuming' ? '1' : '0' },
        ],
        securityContext: {
          runAsUser: 0,
          runAsGroup: 0,
          privileged: true,
          allowPrivilegeEscalation: true,
          readOnlyRootFilesystem: false,
          capabilities: { add: ['SYS_ADMIN', 'SYS_PTRACE'], drop: ['ALL'] },
        },
        resources: { requests: resourceRequests, limits: resourceLimits },
        volumeMounts: [
          { name: 'host-root', mountPath: '/host', mountPropagation: 'HostToContainer' },
          { name: 'connector-token', mountPath: '/run/support-connector', readOnly: true },
          { name: 'reconnect-token', mountPath: '/run/support-reconnect' },
          { name: 'recordings', mountPath: `/host${recordingHostPath}` },
        ],
      }],
      volumes: [
        { name: 'host-root', hostPath: { path: '/', type: 'Directory' } },
        {
          name: 'connector-token',
          secret: { secretName: names.secret, defaultMode: 0o400, items: [{ key: 'connector-token', path: 'connector-token', mode: 0o400 }] },
        },
        { name: 'reconnect-token', emptyDir: { medium: 'Memory', sizeLimit: '64Ki' } },
        { name: 'recordings', hostPath: { path: recordingHostPath, type: 'DirectoryOrCreate' } },
      ],
    },
  };
}

export async function cleanupSupportResources(kube, sessionId) {
  const names = supportResourceNames(sessionId);
  const failures = [];
  for (const [kind, name] of [['pod', names.pod], ['secret', names.secret]]) {
    try {
      const result = await kube.delete(kind, name, SUPPORT_NAMESPACE);
      if (result && result.ok === false && result.status !== 404) failures.push(`${kind}:${name}`);
    } catch { failures.push(`${kind}:${name}`); }
  }
  if (failures.length) throw new SupportKubernetesError('cleanup_failure', 'Support resources could not be fully removed.', 502);
  return { ok: true };
}

export const _private = { DIGEST_IMAGE_RE };
