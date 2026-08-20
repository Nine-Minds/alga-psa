import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cleanupSupportResources, buildSupportConnectorSecret, buildSupportPod, isValidSupportAgentImage, SUPPORT_NAMESPACE } from './support-kubernetes.mjs';
import { LOCAL_RETENTION_MS, listRecordingMetadata, pruneRecordings, readBoundedFile, recordingDirectory, verifyRecordingReceipt, writeAtomicJson } from './support-recordings.mjs';

export const SUPPORT_DURATIONS = Object.freeze([1, 4, 8]);
export const SUPPORT_MAX_HOURS = 8;
export const SUPPORT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SUPPORT_RECONNECT_GRACE_MS = 2 * 60 * 1000;
export const SUPPORT_PROVISIONING_TIMEOUT_MS = 60 * 1000;
export const SUPPORT_STATE_SCHEMA = 1;
const MAX_STATE_BYTES = 256 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SupportSessionError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = 'SupportSessionError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeSupportDuration(value) {
  const hours = typeof value === 'number' ? value : Number(String(value || '').trim());
  if (!Number.isInteger(hours) || !SUPPORT_DURATIONS.includes(hours)) throw new SupportSessionError('invalid_duration', 'Choose a one-, four-, or eight-hour support window.', 400);
  return hours;
}

export function supportCapability({ license = {}, centralConfigured = false, supportAgentImage = null } = {}) {
  const edition = String(license.edition || '').toLowerCase();
  if (!['pro', 'premium'].includes(edition)) return { eligible: false, reason: 'pro_required', edition: license.edition || null, connected: false, centralConfigured, supportAgentAvailable: Boolean(supportAgentImage) };
  const connected = license.source === 'live' && license.status === 'active';
  if (!connected) return { eligible: false, reason: 'connected_appliance_required', edition: license.edition || null, connected: false, centralConfigured, supportAgentAvailable: Boolean(supportAgentImage) };
  if (!centralConfigured) return { eligible: false, reason: 'central_service_unavailable', edition: license.edition || null, connected: true, centralConfigured: false, supportAgentAvailable: Boolean(supportAgentImage) };
  if (!isValidSupportAgentImage(supportAgentImage)) return { eligible: false, reason: 'control_plane_update_required', edition: license.edition || null, connected: true, centralConfigured: true, supportAgentAvailable: false };
  return { eligible: true, reason: null, edition: license.edition || null, connected: true, centralConfigured: true, supportAgentAvailable: true };
}

function validId(value) { return typeof value === 'string' && UUID_RE.test(value); }
function iso(value, field) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new SupportSessionError('invalid_state', `Support state has an invalid ${field}.`, 500); return new Date(parsed).toISOString(); }

function validateDescriptor(value) {
  if (!value || value.schema !== SUPPORT_STATE_SCHEMA || !validId(value.sessionId)) throw new SupportSessionError('invalid_state', 'Support state is missing or invalid.', 500);
  normalizeSupportDuration(value.durationHours);
  for (const field of ['createdAt', 'activatedAt', 'expiresAt']) iso(value[field], field);
  if (!['pending_ack', 'provisioning', 'ready', 'redeemed', 'connected', 'disconnected', 'reconnecting', 'revoked', 'expired', 'failed'].includes(value.state)) throw new SupportSessionError('invalid_state', 'Support state contains an unknown lifecycle state.', 500);
  if (value.shareCode !== undefined && value.shareCode !== null && (typeof value.shareCode !== 'string' || value.shareCode.length > 32)) throw new SupportSessionError('invalid_state', 'Support state contains an invalid share code.', 500);
  return value;
}

function safeJsonRead(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_STATE_BYTES) throw new SupportSessionError('invalid_state', 'Support state exceeds its bounded size.', 500);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new SupportSessionError('invalid_state', 'Support state is not valid JSON.', 500); }
}

function secureDir(directory) { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700); }

function atomicJson(file, value) {
  secureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

function errorCode(error) { return error?.code || 'central_unavailable'; }

export class SupportSessionManager {
  constructor({
    stateDir = process.env.ALGA_APPLIANCE_SUPPORT_STATE_DIR || '/var/lib/alga-appliance/support-sessions',
    central,
    kube,
    getLicense,
    getSupportAgentImage,
    getCredential,
    now = () => Date.now(),
    waitForReadiness,
    publicReceiptKey = process.env.ALGA_SUPPORT_RECEIPT_PUBLIC_KEY || null,
  } = {}) {
    if (!central || !kube || typeof getLicense !== 'function' || typeof getSupportAgentImage !== 'function' || typeof getCredential !== 'function') throw new Error('SupportSessionManager dependencies are incomplete.');
    this.stateDir = path.resolve(stateDir);
    this.activeFile = path.join(this.stateDir, 'active.json');
    this.revokedDir = path.join(this.stateDir, 'revoked');
    this.historyDir = path.join(this.stateDir, 'history');
    this.recordingRoot = this.historyDir;
    this.central = central;
    this.kube = kube;
    this.getLicense = getLicense;
    this.getSupportAgentImage = getSupportAgentImage;
    this.getCredential = getCredential;
    this.now = now;
    this.waitForReadiness = waitForReadiness || (async () => ({ ready: false, recorderReady: false }));
    this.publicReceiptKey = publicReceiptKey;
    this.mutation = Promise.resolve();
    this.expiryTimer = null;
    secureDir(this.stateDir); secureDir(this.revokedDir); secureDir(this.historyDir);
    try {
      const existing = this._readActive();
      if (existing) this._scheduleExpiry(existing);
    } catch { /* startup reconciliation removes corrupt authority before serving mutations */ }
  }

  _readActive() {
    const value = safeJsonRead(this.activeFile);
    return value ? validateDescriptor(value) : null;
  }

  _writeActive(value) { atomicJson(this.activeFile, validateDescriptor(value)); }
  _clearActive() { try { fs.unlinkSync(this.activeFile); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  _historyPath(id) { if (!validId(id)) throw new SupportSessionError('invalid_session_id', 'Support session ID is invalid.', 400); return path.join(this.historyDir, id); }

  _scheduleExpiry(descriptor) {
    clearTimeout(this.expiryTimer);
    const delay = Math.max(1, Date.parse(descriptor.expiresAt) - this.now());
    this.expiryTimer = setTimeout(() => {
      this._serialize(async () => {
        const active = this._readActive();
        if (active?.sessionId === descriptor.sessionId && Date.parse(active.expiresAt) <= this.now() && !['revoked', 'expired', 'failed'].includes(active.state)) await this._closeLocal(active, 'local-expired', 'expired');
      }).catch(() => {});
    }, delay);
    this.expiryTimer.unref?.();
  }

  _publicDescriptor(value) {
    if (!value) return null;
    const { applianceToken, resumeGrant, shareCode, ...publicValue } = value;
    return { ...publicValue, shareCode: value.state === 'ready' && shareCode ? shareCode : null };
  }

  async _capability() {
    let license = {};
    try { license = await this.getLicense(); } catch { license = { status: 'unknown' }; }
    let image = null;
    try { image = await this.getSupportAgentImage(); } catch { image = null; }
    return { ...supportCapability({ license, centralConfigured: this.central.configured, supportAgentImage: image }), supportAgentImage: image };
  }

  async snapshot({ refresh = false } = {}) {
    const capability = await this._capability();
    let active = this._readActive();
    if (refresh && active && ['pending_ack', 'provisioning', 'ready', 'redeemed', 'connected', 'disconnected', 'reconnecting'].includes(active.state)) {
      try {
        const central = await this.central.getSession(active.sessionId, active.applianceToken);
        if (central?.state === 'revoked' || central?.state === 'expired' || central?.terminal === true) {
          active = await this._closeLocal(active, central.state === 'revoked' ? 'central-revoked' : 'central-expired', central.state === 'revoked' ? 'revoked' : 'expired');
        } else if (central?.operatorEmail || central?.operatorSubject) {
          active.operator = { subject: central.operatorSubject || null, email: central.operatorEmail || null, boundAt: central.redeemedAt || active.operator?.boundAt || null };
          active.state = central.state === 'connected' ? 'connected' : (active.state === 'ready' ? 'redeemed' : active.state);
          active.shareCode = null;
          this._writeActive(active);
        }
      } catch { /* preserve the last local state during a transient central outage */ }
    }
    const history = this._listHistory();
    return { capability: { ...capability, supportAgentImage: undefined }, active: this._publicDescriptor(active), history };
  }

  _listHistory() {
    if (!fs.existsSync(this.historyDir)) return [];
    return fs.readdirSync(this.historyDir).filter((id) => validId(id)).slice(0, 256).map((id) => {
      try { return safeJsonRead(path.join(this.historyDir, id, 'metadata.json')); } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')));
  }

  async _getPodStatus(sessionId) {
    if (typeof this.kube.getPod !== 'function') return null;
    try { return await this.kube.getPod(SUPPORT_NAMESPACE, `support-${sessionId}`); } catch { return null; }
  }

  async _provision(descriptor, connectorToken, supportAgentImage) {
    const secret = buildSupportConnectorSecret({ sessionId: descriptor.sessionId, connectorToken });
    const pod = buildSupportPod({ session: descriptor, supportAgentImage, nowMs: this.now() });
    await this.kube.apply(secret);
    try { await this.kube.apply(pod); } catch (error) {
      try { await cleanupSupportResources(this.kube, descriptor.sessionId); } catch { /* original failure is more useful */ }
      throw new SupportSessionError('pod_failure', 'The support agent could not be started.', 502, errorCode(error));
    }
    const deadline = this.now() + SUPPORT_PROVISIONING_TIMEOUT_MS;
    let ready = false;
    while (this.now() < deadline) {
      const result = await this.waitForReadiness({ session: descriptor, pod: await this._getPodStatus(descriptor.sessionId) });
      if (result?.ready && result?.recorderReady !== false) { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new SupportSessionError('provisioning_timeout', 'Support recording and relay readiness were not reached.', 504);
    try { await this.kube.delete('secret', `support-${descriptor.sessionId}-connector`, SUPPORT_NAMESPACE); } catch (error) { throw new SupportSessionError('cleanup_failure', 'The connector secret could not be removed after readiness.', 502, errorCode(error)); }
  }

  async _closeLocal(descriptor, reason, terminalState = 'failed') {
    const next = { ...descriptor, state: terminalState, lastStopReason: reason, closedAt: new Date(this.now()).toISOString(), shareCode: null };
    secureDir(this._historyPath(descriptor.sessionId));
    atomicJson(path.join(this._historyPath(descriptor.sessionId), 'metadata.json'), { schema: SUPPORT_STATE_SCHEMA, ...this._publicDescriptor(next), closedAt: next.closedAt, lastStopReason: reason, recording: next.recording || { bytes: 0, segments: [] } });
    try { await cleanupSupportResources(this.kube, descriptor.sessionId); } catch { /* cleanup is retried by reconciliation */ }
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this._clearActive();
    return next;
  }

  async create({ durationHours = 4 } = {}) {
    return this._serialize(async () => {
      const duration = normalizeSupportDuration(durationHours);
      const capability = await this._capability();
      if (!capability.eligible) throw new SupportSessionError(capability.reason, capability.reason === 'pro_required' ? 'Remote support is available only on connected Pro appliances.' : 'Remote support is not ready on this appliance.', 412);
      if (this._readActive()) throw new SupportSessionError('already_active', 'Only one support window can be active.', 409);
      const image = capability.supportAgentImage;
      const createdAt = new Date(this.now()).toISOString();
      const clientRequestId = crypto.randomUUID();
      let central;
      try { central = await this.central.createSession({ durationHours: duration, credential: await this.getCredential(), clientRequestId }); } catch (error) { throw new SupportSessionError(errorCode(error), 'The central support service did not approve this window.', error?.status || 503); }
      const descriptor = validateDescriptor({ schema: SUPPORT_STATE_SCHEMA, sessionId: central.sessionId, state: 'pending_ack', createdAt, activatedAt: central.activatedAt, expiresAt: central.expiresAt, durationHours: duration, statusUrl: central.statusUrl, relayUrl: central.relayUrl, applianceToken: central.applianceToken, resumeGrant: central.resumeGrant, connectorState: 'pending', operator: null, recording: { bytes: 0, segments: [] }, lastStopReason: null, shareCode: central.shareCode, supportAgentImage: image });
      this._writeActive(descriptor);
      try {
        await this.central.acknowledge(descriptor.sessionId, descriptor.applianceToken);
        descriptor.state = 'provisioning'; descriptor.connectorState = 'starting'; this._writeActive(descriptor);
        await this._provision(descriptor, central.connectorToken, image);
        descriptor.state = 'ready'; descriptor.connectorState = 'ready'; this._writeActive(descriptor);
        this._scheduleExpiry(descriptor);
        return this._publicDescriptor(descriptor);
      } catch (error) {
        descriptor.state = 'failed'; descriptor.lastStopReason = errorCode(error);
        try { await this.central.abandon(descriptor.sessionId, descriptor.applianceToken); } catch { /* central cleanup is retried by the service */ }
        await this._closeLocal(descriptor, errorCode(error), 'failed');
        if (error instanceof SupportSessionError) throw error;
        throw new SupportSessionError('provisioning_timeout', 'Support provisioning failed before readiness.', 504);
      }
    });
  }

  async extend(sessionId, durationHours) {
    return this._serialize(async () => {
      const duration = normalizeSupportDuration(durationHours);
      const active = this._readActive();
      if (!active || active.sessionId !== sessionId) throw new SupportSessionError('not_found', 'Support session was not found.', 404);
      if (['revoked', 'expired', 'failed'].includes(active.state)) throw new SupportSessionError('closed', 'Support session is already closed.', 409);
      if (duration <= active.durationHours || Date.parse(active.activatedAt) + duration * 3600000 <= this.now() || duration > SUPPORT_MAX_HOURS) throw new SupportSessionError('invalid_duration', 'Support can only move forward along the one-, four-, eight-hour ladder.', 400);
      let result;
      try { result = await this.central.extend(sessionId, active.applianceToken, duration); } catch (error) { throw new SupportSessionError(errorCode(error), 'Central support service rejected the extension.', error?.status || 503); }
      if (typeof result?.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw new SupportSessionError('central_invalid_response', 'Central support service returned an invalid extension.', 502);
      active.durationHours = duration; active.expiresAt = result.expiresAt;
      this._writeActive(active);
      this._scheduleExpiry(active);
      return this._publicDescriptor(active);
    });
  }

  async revoke(sessionId) {
    return this._serialize(async () => {
      const active = this._readActive();
      if (!active || active.sessionId !== sessionId) throw new SupportSessionError('not_found', 'Support session was not found.', 404);
      atomicJson(path.join(this.revokedDir, `${sessionId}.json`), { schema: SUPPORT_STATE_SCHEMA, sessionId, revokedAt: new Date(this.now()).toISOString() });
      const closed = await this._closeLocal(active, 'local-revoked', 'revoked');
      try { await this.central.revoke(sessionId, active.applianceToken); } catch { /* local revocation is authoritative; retry central close on reconcile */ }
      return this._publicDescriptor(closed);
    });
  }

  async reconcileStartup() {
    let active;
    try { active = this._readActive(); } catch {
      if (typeof this.kube.listSupportPods === 'function') {
        for (const pod of await this.kube.listSupportPods()) { try { await cleanupSupportResources(this.kube, pod.sessionId); } catch {} }
      }
      this._clearActive();
      return { ok: true, state: 'corrupt-state-closed' };
    }
    if (!active) {
      pruneRecordings(this.recordingRoot, { nowMs: this.now(), retentionMs: LOCAL_RETENTION_MS });
      if (typeof this.kube.listSupportPods === 'function') {
        for (const pod of await this.kube.listSupportPods()) { try { await cleanupSupportResources(this.kube, pod.sessionId); } catch {} }
      }
      return { ok: true, state: 'idle' };
    }
    pruneRecordings(this.recordingRoot, { nowMs: this.now(), retentionMs: LOCAL_RETENTION_MS, activeSessionIds: [active.sessionId] });
    if (Date.parse(active.expiresAt) <= this.now()) { await this._closeLocal(active, 'local-expired', 'expired'); return { ok: true, state: 'expired' }; }
    if (fs.existsSync(path.join(this.revokedDir, `${active.sessionId}.json`))) { await this._closeLocal(active, 'revoked-tombstone', 'revoked'); return { ok: true, state: 'revoked' }; }
    if (active.state === 'pending_ack') {
      try { await this.central.abandon(active.sessionId, active.applianceToken); } catch { /* central expiry remains authoritative */ }
      await this._closeLocal(active, 'unacknowledged-startup-state', 'failed');
      return { ok: true, state: 'failed' };
    }
    try {
      const central = await this.central.getSession(active.sessionId, active.applianceToken);
      if (central?.state === 'revoked' || central?.state === 'expired' || central?.terminal) { await this._closeLocal(active, `central-${central.state || 'closed'}`, central.state === 'revoked' ? 'revoked' : 'expired'); return { ok: true, state: 'closed' }; }
      if (!central?.active && active.state !== 'pending_ack') { await this._closeLocal(active, 'central-rejected', 'failed'); return { ok: true, state: 'failed' }; }
      this._scheduleExpiry(active);
      if (active.state === 'provisioning' || (typeof this.kube.getPod === 'function' && !(await this._getPodStatus(active.sessionId)))) {
        if (active.state === 'provisioning') {
          try { await cleanupSupportResources(this.kube, active.sessionId); } catch { return { ok: false, state: active.state, reason: 'cleanup_failure' }; }
        }
        const image = await this.getSupportAgentImage();
        const resumed = await this.central.resume(active.sessionId, active.resumeGrant);
        active.state = 'reconnecting'; active.connectorState = 'resuming'; this._writeActive(active);
        await this._provision(active, resumed.connectorToken, image);
        active.state = active.operator ? 'redeemed' : 'ready'; active.connectorState = 'ready'; this._writeActive(active);
      }
      return { ok: true, state: active.state };
    } catch (error) {
      // A central outage must not turn an already authorized, unexpired local
      // window into new authority. Keep the descriptor for bounded retry, but
      // never create a pod without a successful resume exchange.
      return { ok: false, state: active.state, reason: errorCode(error) };
    }
  }

  recordingMetadata(sessionId) {
    if (!validId(sessionId)) throw new SupportSessionError('invalid_session_id', 'Support session ID is invalid.', 400);
    const active = this._readActive();
    const history = safeJsonRead(path.join(this.historyDir, sessionId, 'metadata.json'));
    if (!history && (!active || active.sessionId !== sessionId)) throw new SupportSessionError('not_found', 'Recording was not found.', 404);
    const segments = listRecordingMetadata(this.recordingRoot, sessionId).map((segment) => ({
      ...segment,
      verification: verifyRecordingReceipt(segment, segment.receipt, this.publicReceiptKey),
    }));
    return { sessionId, segments, verified: segments.length > 0 && segments.every((segment) => segment.verification.valid), active: Boolean(active && active.sessionId === sessionId) };
  }

  readRecording(sessionId) {
    const metadata = this.recordingMetadata(sessionId);
    if (metadata.active) throw new SupportSessionError('recording_active', 'Only finalized recordings can be read.', 409);
    const directory = recordingDirectory(this.recordingRoot, sessionId);
    const files = fs.readdirSync(directory).filter((name) => /^segment-[0-9a-f-]+\.cast$/i.test(name)).sort().slice(0, 256);
    return Buffer.concat(files.map((name) => readBoundedFile(path.join(directory, name))));
  }

  deleteRecording(sessionId) {
    const active = this._readActive();
    if (active?.sessionId === sessionId) throw new SupportSessionError('recording_active', 'Active recordings cannot be deleted.', 409);
    if (!validId(sessionId)) throw new SupportSessionError('invalid_session_id', 'Support session ID is invalid.', 400);
    const directory = recordingDirectory(this.recordingRoot, sessionId);
    if (!fs.existsSync(directory)) throw new SupportSessionError('not_found', 'Recording was not found.', 404);
    fs.rmSync(directory, { recursive: true, force: true });
    return { ok: true };
  }

  _serialize(operation) { const run = this.mutation.then(operation, operation); this.mutation = run.catch(() => {}); return run; }
}
