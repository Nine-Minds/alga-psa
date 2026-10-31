/**
 * Validates and normalises an admin-entered download-host pattern
 * (Settings > MCP Server > Allowed download hosts).
 *
 * The refusals here are platform rules tenants cannot override. The messages are shown
 * to the admin in the UI as written, so they are plain sentences.
 *
 * The address checks (private ranges, pinning) are NOT repeated here: they run at fetch
 * time on every request (`safeFetch`).
 */
import { isIP } from 'node:net';
import { normalizeHostForMatching } from '../../../net/safeFetch';

export type HostPatternResult =
  | { ok: true; pattern: string }
  | { ok: false; message: string };

/**
 * Shared cloud-storage and hosting suffixes. Anyone can put a file under these, so an
 * entry that covers the whole suffix would let any third party's content through.
 * A bucket- or site-specific host *under* a suffix (acme-uploads.s3.us-east-1.amazonaws.com)
 * is fine and is the recommended form.
 */
const SHARED_SUFFIXES: readonly string[] = [
  // Object storage
  's3.amazonaws.com',
  'blob.core.windows.net',
  'file.core.windows.net',
  'web.core.windows.net',
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
  'r2.cloudflarestorage.com',
  'r2.dev',
  'digitaloceanspaces.com',
  'backblazeb2.com',
  // Shared hosting / CDN
  'cloudfront.net',
  'github.io',
  'githubusercontent.com',
  'pages.dev',
  'workers.dev',
  'netlify.app',
  'vercel.app',
  'herokuapp.com',
  'azurewebsites.net',
  'web.app',
  'firebaseapp.com',
];

/** Regional / path-style endpoints that are shared as exact hosts too (e.g. s3.us-east-1.amazonaws.com). */
const SHARED_ENDPOINT_PATTERNS: readonly RegExp[] = [
  /^s3([.-][a-z0-9-]+)*\.amazonaws\.com$/,
  /^[a-z0-9-]+\.digitaloceanspaces\.com$/,
];

/** A wildcard on these bases would also cover the shared endpoints above, so it is refused. */
const SHARED_ENDPOINT_ANCESTORS: readonly RegExp[] = [/^amazonaws\.com$/, /^[a-z0-9-]+\.amazonaws\.com$/];

function isSharedEndpoint(host: string): boolean {
  return SHARED_SUFFIXES.includes(host) || SHARED_ENDPOINT_PATTERNS.some((re) => re.test(host));
}

/** True when `*.base` would match a shared suffix or endpoint. */
function wildcardCoversShared(base: string): boolean {
  if (isSharedEndpoint(base)) return true;
  if (SHARED_ENDPOINT_ANCESTORS.some((re) => re.test(base))) return true;
  return SHARED_SUFFIXES.some((suffix) => suffix.endsWith(`.${base}`));
}

const SHARED_MESSAGE = (shown: string) =>
  `${shown} is a shared storage or hosting domain. Anyone can publish files there, so allowing it would let any third party's files be downloaded into your workspace. Enter the specific bucket or site host instead, for example acme-uploads.s3.us-east-1.amazonaws.com.`;

export function validateHostPattern(input: string): HostPatternResult {
  const raw = (input ?? '').trim();
  if (!raw) return refuse('Enter a host name, for example files.example.com.');
  if (/\s/.test(raw)) return refuse('A host name cannot contain spaces.');

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return refuse('Enter only the host name, without a scheme such as https://.');
  }
  if (raw.includes('@')) return refuse('Enter only the host name, without a user name or password.');
  if (/[/?#]/.test(raw)) return refuse('Enter only the host name, without a path, query or fragment.');

  if (isIP(raw.replace(/^\[/, '').replace(/\]$/, '')) || raw.startsWith('[')) {
    return refuse('IP addresses are not allowed. Enter a host name.');
  }
  if (raw.includes(':')) return refuse('Enter only the host name, without a port. Downloads always use port 443.');
  if (raw.endsWith('.')) return refuse('Remove the trailing dot from the host name.');

  const wildcard = raw.startsWith('*.');
  if (raw.includes('*') && !wildcard) {
    return refuse('A wildcard is allowed only as a leading "*." before a domain, for example *.files.example.com.');
  }
  const body = wildcard ? raw.slice(2) : raw;
  if (body.includes('*')) return refuse('Only one leading "*." wildcard is allowed.');
  if (body === '') return refuse('Enter a domain after "*.", for example *.files.example.com.');

  const host = normalizeHostForMatching(body);
  if (!host || /\.\./.test(host) || host.startsWith('.')) return refuse('That is not a valid host name.');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
    return refuse('That is not a valid host name. Use letters, digits, hyphens and dots.');
  }

  const labels = host.split('.');
  // Catches decimal / hex / octal IPv4 spellings that the URL parser would turn into an address.
  let asUrlHost = host;
  try {
    asUrlHost = new URL(`https://${host}`).hostname;
  } catch {
    return refuse('That is not a valid host name.');
  }
  if (isIP(asUrlHost) || /^\d+$/.test(labels[labels.length - 1]!)) {
    return refuse('IP addresses are not allowed. Enter a host name.');
  }

  if (host === 'localhost' || host.endsWith('.localhost')) {
    return refuse('localhost is not allowed. Downloads from local addresses are always blocked.');
  }
  if (wildcard && labels.length < 2) {
    return refuse('A wildcard needs at least two labels after "*.", for example *.files.example.com. Wildcards like *.com are too broad.');
  }
  if (labels.length < 2) {
    return refuse('Enter a full domain name such as files.example.com, not a single word.');
  }

  const shown = wildcard ? `*.${host}` : host;
  if (wildcard ? wildcardCoversShared(host) : isSharedEndpoint(host)) {
    return refuse(SHARED_MESSAGE(shown));
  }
  return { ok: true, pattern: shown };
}

function refuse(message: string): HostPatternResult {
  return { ok: false, message };
}
