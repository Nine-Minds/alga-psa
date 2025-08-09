const forwardAllow = new Set([
  'x-request-id',
  'accept',
  'content-type',
  'accept-encoding',
  'user-agent',
]);

export function filterRequestHeaders(inHeaders: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of inHeaders.entries()) {
    const key = k.toLowerCase();
    if (key === 'authorization') continue; // strip end-user auth
    if (forwardAllow.has(key)) out[key] = v;
  }
  return out;
}

const responseAllow = new Set(['content-type', 'cache-control', 'etag']);

export function filterResponseHeaders(inHeaders: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of inHeaders.entries()) {
    const key = k.toLowerCase();
    if (responseAllow.has(key)) out[key] = v;
  }
  return out;
}

