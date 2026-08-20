import crypto from 'node:crypto';

const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHARE_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;
const MAX_TOKEN_BYTES = 4096;
const MAX_URL_LENGTH = 2048;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_SUPPORT_HOURS = 8;

export class SupportControlError extends Error {
  constructor(code, message, status = 502, details = undefined) {
    super(message);
    this.name = 'SupportControlError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function requireSessionId(value) {
  const id = String(value || '').trim();
  if (!SESSION_ID_RE.test(id)) throw new SupportControlError('invalid_session_id', 'Support session ID is invalid.', 400);
  return id;
}

function requireHttpsUrl(value, name) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new SupportControlError('central_unavailable', `${name} is not configured.`, 503); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash || String(value).length > MAX_URL_LENGTH) throw new SupportControlError('central_unavailable', `${name} must use HTTPS.`, 503);
  return url;
}

function requireDescriptorUrl(value, name, protocol) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new SupportControlError('central_invalid_response', `Central response contains an invalid ${name}.`, 502); }
  if (url.protocol !== protocol || !url.hostname || url.username || url.password || url.hash || String(value).length > MAX_URL_LENGTH) throw new SupportControlError('central_invalid_response', `Central response contains an invalid ${name}.`, 502);
  return value;
}

function boundedJsonParse(text) {
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new SupportControlError('central_invalid_response', 'Central support service returned an oversized response.', 502);
  try { return JSON.parse(text || '{}'); } catch { throw new SupportControlError('central_invalid_response', 'Central support service returned invalid JSON.', 502); }
}

function publicError(body, fallback) {
  const code = typeof body?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(body.code) ? body.code : fallback;
  const message = code === 'rate_limited'
    ? 'Remote support requests are temporarily rate-limited.'
    : code === 'not_eligible'
      ? 'This appliance is not eligible for remote support.'
      : 'Central support service rejected the request.';
  return { code, message };
}

function validateCreateResponse(body, { durationHours, nowMs = Date.now() } = {}) {
  const allowed = new Set(['sessionId', 'shareCode', 'connectorToken', 'applianceToken', 'resumeGrant', 'statusUrl', 'relayUrl', 'activatedAt', 'expiresAt']);
  if (Object.keys(body || {}).some((key) => !allowed.has(key))) throw new SupportControlError('central_invalid_response', 'Central response contains an unexpected field.', 502);
  for (const key of ['sessionId', 'shareCode', 'connectorToken', 'applianceToken', 'resumeGrant', 'statusUrl', 'relayUrl', 'activatedAt', 'expiresAt']) {
    if (typeof body?.[key] !== 'string' || !body[key].trim()) throw new SupportControlError('central_invalid_response', `Central response is missing ${key}.`, 502);
  }
  if (!SESSION_ID_RE.test(body.sessionId)) throw new SupportControlError('central_invalid_response', 'Central response contains an invalid session ID.', 502);
  if (!/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/.test(body.shareCode)) throw new SupportControlError('central_invalid_response', 'Central response contains an invalid share code.', 502);
  for (const key of ['connectorToken', 'applianceToken', 'resumeGrant']) if (Buffer.byteLength(body[key], 'utf8') > MAX_TOKEN_BYTES) throw new SupportControlError('central_invalid_response', 'Central response contains an oversized token.', 502);
  requireDescriptorUrl(body.statusUrl, 'statusUrl', 'https:');
  requireDescriptorUrl(body.relayUrl, 'relayUrl', 'wss:');
  const activatedAt = Date.parse(body.activatedAt);
  const expiresAt = Date.parse(body.expiresAt);
  if (!Number.isFinite(activatedAt) || !Number.isFinite(expiresAt) || activatedAt > nowMs + MAX_CLOCK_SKEW_MS || expiresAt <= nowMs || expiresAt > activatedAt + Number(durationHours) * 3600000 || expiresAt > activatedAt + MAX_SUPPORT_HOURS * 3600000) {
    throw new SupportControlError('central_invalid_response', 'Central response contains an invalid support window.', 502);
  }
  return body;
}

export class SupportControlClient {
  constructor({ baseUrl = process.env.ALGA_SUPPORT_CONTROL_URL, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, serviceName = 'appliance-host-service' } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('SupportControlClient requires fetch.');
    this.baseUrl = baseUrl ? requireHttpsUrl(baseUrl, 'ALGA_SUPPORT_CONTROL_URL') : null;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.serviceName = serviceName;
  }

  get configured() { return Boolean(this.baseUrl); }

  async request(method, pathname, body, { applianceToken = null, signal } = {}) {
    if (!this.baseUrl) throw new SupportControlError('central_unavailable', 'Remote support central service is not configured.', 503);
    const target = new URL(pathname, this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    const headers = { accept: 'application/json', 'content-type': 'application/json', 'x-client': this.serviceName };
    if (applianceToken) headers.authorization = `Bearer ${applianceToken}`;
    // The credential is intentionally only serialized into this request body.
    const payload = body === undefined ? undefined : JSON.stringify(body);
    try {
      const response = await this.fetchImpl(target, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
      const text = await response.text();
      const parsed = boundedJsonParse(text);
      if (!response.ok) {
        const error = publicError(parsed, response.status >= 500 ? 'central_unavailable' : 'central_rejected');
        throw new SupportControlError(error.code, error.message, response.status);
      }
      return parsed;
    } catch (error) {
      if (error instanceof SupportControlError) throw error;
      const code = error?.name === 'AbortError' ? 'central_timeout' : 'central_unavailable';
      throw new SupportControlError(code, 'Remote support central service is unavailable.', 503);
    } finally {
      clearTimeout(timer);
    }
  }

  async createSession({ durationHours, credential, clientRequestId = crypto.randomUUID() }) {
    if (typeof credential !== 'string' || credential.length < 16) throw new SupportControlError('central_rejected', 'Appliance credential is unavailable.', 503);
    const response = await this.request('POST', '/v1/appliance/sessions', {
      durationHours,
      clientRequestId,
      credential,
    });
    try {
      return validateCreateResponse(response, { durationHours, nowMs: Date.now() });
    } catch (error) {
      // A malformed create response may still contain enough authority to
      // close the central pending record. Never persist it locally, but make
      // the cleanup attempt before returning the validation failure.
      if (SESSION_ID_RE.test(String(response?.sessionId || '')) && typeof response?.applianceToken === 'string' && response.applianceToken.length >= 16 && response.applianceToken.length <= MAX_TOKEN_BYTES) {
        try { await this.abandon(response.sessionId, response.applianceToken); } catch { /* best effort; the malformed authority was never persisted */ }
      }
      throw error;
    }
  }

  acknowledge(sessionId, applianceToken) {
    return this.request('POST', `/v1/appliance/sessions/${requireSessionId(sessionId)}/acknowledge`, {}, { applianceToken });
  }

  abandon(sessionId, applianceToken) {
    return this.request('DELETE', `/v1/appliance/sessions/${requireSessionId(sessionId)}`, {}, { applianceToken });
  }

  getSession(sessionId, applianceToken) {
    return this.request('GET', `/v1/appliance/sessions/${requireSessionId(sessionId)}`, undefined, { applianceToken });
  }

  extend(sessionId, applianceToken, durationHours) {
    return this.request('POST', `/v1/appliance/sessions/${requireSessionId(sessionId)}/extend`, { durationHours }, { applianceToken });
  }

  revoke(sessionId, applianceToken) {
    return this.request('POST', `/v1/appliance/sessions/${requireSessionId(sessionId)}/revoke`, {}, { applianceToken });
  }

  resume(sessionId, resumeGrant) {
    return this.request('POST', `/v1/appliance/sessions/${requireSessionId(sessionId)}/resume`, { resumeGrant });
  }

  checkpoint(sessionId, applianceToken, checkpoint) {
    return this.request('POST', `/v1/appliance/sessions/${requireSessionId(sessionId)}/recordings/checkpoint`, checkpoint, { applianceToken });
  }

  finalize(sessionId, applianceToken, segment) {
    return this.request('POST', `/v1/appliance/sessions/${requireSessionId(sessionId)}/recordings/finalize`, segment, { applianceToken });
  }
}

export const _private = { requireSessionId, requireHttpsUrl, requireDescriptorUrl, boundedJsonParse, validateCreateResponse, SHARE_CODE_RE };
