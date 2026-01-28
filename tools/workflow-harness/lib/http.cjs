class HttpError extends Error {
  constructor(message, { status, details } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createHttpClient({ baseUrl, tenantId, cookie, debug = false, fetchImpl = fetch }) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error('createHttpClient requires baseUrl');

  async function request(path, opts = {}) {
    const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    const method = (opts.method ?? 'GET').toUpperCase();
    const headers = { ...(opts.headers ?? {}) };
    if (cookie) headers.Cookie = cookie;
    if (tenantId) headers['x-tenant-id'] = tenantId;
    const envApiKey = process.env.WORKFLOW_HARNESS_API_KEY || process.env.ALGA_API_KEY || '';
    if (envApiKey) {
      const hasApiKeyHeader = Object.keys(headers).some((k) => String(k).toLowerCase() === 'x-api-key');
      if (!hasApiKeyHeader) headers['x-api-key'] = envApiKey;
    }

    let body = opts.body;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }

    if (debug) {
      // eslint-disable-next-line no-console
      console.error(`[http] ${method} ${url}`);
    }

    const res = await fetchImpl(url, { method, headers, body });
    const text = await res.text();

    if (!res.ok) {
      const parsed = tryParseJson(text);
      const details = parsed ?? { error: text };
      throw new HttpError(`HTTP ${res.status}: ${details?.error ?? 'Request failed'}`, {
        status: res.status,
        details
      });
    }

    return {
      status: res.status,
      headers: res.headers,
      text,
      json: tryParseJson(text)
    };
  }

  return { request };
}

module.exports = {
  HttpError,
  createHttpClient
};
