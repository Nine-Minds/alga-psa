/**
 * Gmail Pub/Sub naming and base-URL derivation.
 *
 * Gmail push delivery survives on one invariant: the audience Google signs its
 * OIDC token with at provisioning time must be byte-identical to the audience
 * the webhook route checks that token against. A single character of drift —
 * a trailing slash, an uppercase host, an explicit `:443` — turns every push
 * into a 401 that no part of the product notices. Provisioning, verification,
 * and diagnostics therefore all derive their strings from this module.
 */

import fs from 'fs';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';

/** Route the Google Pub/Sub push subscription delivers to. */
export const GOOGLE_WEBHOOK_PATH = '/api/email/webhooks/google';

/** Google-owned service account that publishes Gmail notifications. */
export const GMAIL_PUSH_SERVICE_ACCOUNT = 'gmail-api-push@system.gserviceaccount.com';

/** Role that service account needs on the tenant's topic. */
export const GMAIL_PUBLISHER_ROLE = 'roles/pubsub.publisher';

/**
 * Base-URL sources in fixed precedence order. Each is read from `process.env`
 * first and from the app secret store second, so a value set either way
 * resolves identically no matter which caller asks.
 */
export const GMAIL_BASE_URL_KEYS = [
  'NGROK_URL',
  'NEXT_PUBLIC_BASE_URL',
  'NEXTAUTH_URL',
  'PUBLIC_WEBHOOK_BASE_URL',
] as const;

// Written by the ngrok-sync container in local development.
const NGROK_URL_FILE = '/app/ngrok/url';

const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'host.docker.internal',
]);

/**
 * A base URL or Pub/Sub name could not be derived. Callers surface the message
 * verbatim to the administrator — it is written to be actionable.
 */
export class GmailPubSubConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailPubSubConfigurationError';
  }
}

/**
 * A Pub/Sub provisioning step failed against Google. The message names the
 * resource and the missing permission so it can be read straight from the
 * provider card without a log dive.
 */
export class GmailPubSubSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailPubSubSetupError';
  }
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development';
}

/**
 * Reduce a base URL to its canonical form: lowercase scheme and host, no
 * default port, no query or fragment, no trailing slash. Any path component is
 * preserved so instances mounted under a prefix stay self-consistent.
 */
export function normalizeGmailBaseUrl(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    throw new GmailPubSubConfigurationError('The Gmail webhook base URL is empty.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GmailPubSubConfigurationError(
      `"${trimmed}" is not a valid absolute URL. Use a full address such as https://alga.example.com.`
    );
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new GmailPubSubConfigurationError(
      `"${trimmed}" uses the unsupported scheme "${url.protocol}". Use http or https.`
    );
  }

  const host = url.hostname.toLowerCase();
  const portIsDefault =
    !url.port ||
    (protocol === 'https:' && url.port === '443') ||
    (protocol === 'http:' && url.port === '80');
  const authority = portIsDefault ? host : `${host}:${url.port}`;
  const path = url.pathname.replace(/\/+$/, '');

  return `${protocol}//${authority}${path}`;
}

/**
 * Join a normalized base URL with a route path. Both the Pub/Sub push endpoint
 * and the audience the webhook verifies against are produced here, which is
 * what keeps them identical.
 */
export function buildGmailWebhookUrl(baseUrl: string, path: string = GOOGLE_WEBHOOK_PATH): string {
  const base = normalizeGmailBaseUrl(baseUrl);
  const suffix = (path.startsWith('/') ? path : `/${path}`).replace(/\/+$/, '');
  return `${base}${suffix}`;
}

/**
 * Explain why an address cannot receive Pub/Sub push, or `null` when it can.
 * Google only pushes to public HTTPS endpoints, so a loopback or private
 * address means delivery will never arrive no matter how the rest is set up.
 */
export function describeUnreachableGmailBaseUrl(baseUrl: string): string | null {
  const url = new URL(normalizeGmailBaseUrl(baseUrl));
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (url.protocol !== 'https:') {
    return `${baseUrl} is not an HTTPS address.`;
  }
  if (LOOPBACK_HOSTS.has(host)) {
    return `${baseUrl} points at this machine (${host}).`;
  }
  if (/^127\./.test(host) || host.startsWith('::1')) {
    return `${baseUrl} points at the loopback interface.`;
  }
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return `${baseUrl} points at a private network address.`;
  }
  if (/^169\.254\./.test(host)) {
    return `${baseUrl} points at a link-local address.`;
  }
  if (host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    return `${baseUrl} points at a host name that only resolves inside this network.`;
  }

  return null;
}

export interface ResolvedGmailBaseUrl {
  baseUrl: string;
  /** Where the value came from, for diagnostics and error messages. */
  source: string;
}

/**
 * Resolve the public base URL of this Alga instance, normalized.
 * Returns `null` when nothing is configured. Throws when a configured value
 * exists but is unusable, because silently skipping to the next source is how
 * provisioning and verification end up disagreeing.
 */
export async function resolveGmailWebhookBaseUrl(): Promise<ResolvedGmailBaseUrl | null> {
  if (isDevelopment()) {
    try {
      if (fs.existsSync(NGROK_URL_FILE)) {
        const fromFile = fs.readFileSync(NGROK_URL_FILE, 'utf-8').trim();
        if (fromFile) {
          return { baseUrl: normalizeGmailBaseUrl(fromFile), source: NGROK_URL_FILE };
        }
      }
    } catch (error) {
      if (error instanceof GmailPubSubConfigurationError) throw error;
      // An unreadable ngrok file is not a configuration statement; fall through.
    }
  }

  let secretProvider: Awaited<ReturnType<typeof getSecretProviderInstance>> | null = null;

  for (const key of GMAIL_BASE_URL_KEYS) {
    const fromEnv = process.env[key];
    if (fromEnv && fromEnv.trim()) {
      return { baseUrl: normalizeGmailBaseUrl(fromEnv), source: key };
    }

    if (!secretProvider) {
      try {
        secretProvider = await getSecretProviderInstance();
      } catch {
        // No secret store available; environment variables are all we have.
        break;
      }
    }

    const fromSecret = await secretProvider.getAppSecret(key);
    if (fromSecret && fromSecret.trim()) {
      return { baseUrl: normalizeGmailBaseUrl(fromSecret), source: `${key} (app secret)` };
    }
  }

  return null;
}

/**
 * Resolve the base URL and refuse anything Google cannot push to. Setup uses
 * this: a Gmail provider configured against localhost is a broken provider, and
 * saying so during setup is the only moment the administrator can act on it.
 */
export async function requireGmailWebhookBaseUrl(): Promise<ResolvedGmailBaseUrl> {
  const resolved = await resolveGmailWebhookBaseUrl();

  if (!resolved) {
    throw new GmailPubSubConfigurationError(
      `No base URL is configured for Gmail push delivery. Set ${GMAIL_BASE_URL_KEYS.join(' or ')} ` +
        'to the public HTTPS address of this Alga instance.'
    );
  }

  const unreachable = describeUnreachableGmailBaseUrl(resolved.baseUrl);
  if (unreachable) {
    throw new GmailPubSubConfigurationError(
      `${unreachable} Google Pub/Sub only delivers to a publicly reachable HTTPS endpoint, so Gmail push ` +
        `notifications would never arrive. Point ${resolved.source} at the public address of this Alga instance, ` +
        'or set NGROK_URL to a tunnel address for local development.'
    );
  }

  return resolved;
}

export function gmailTopicName(tenantId: string): string {
  return `gmail-notifications-${tenantId}`;
}

export function gmailSubscriptionName(tenantId: string): string {
  return `gmail-webhook-${tenantId}`;
}

export interface GmailPubSubNames extends ResolvedGmailBaseUrl {
  topicName: string;
  subscriptionName: string;
  /** Push endpoint and OIDC audience — the same string, by construction. */
  webhookUrl: string;
}

/**
 * The one derivation of every Gmail Pub/Sub name and URL for a tenant.
 */
export async function getGmailPubSubNames(tenantId: string): Promise<GmailPubSubNames> {
  if (!tenantId) {
    throw new GmailPubSubConfigurationError('A tenant is required to derive Gmail Pub/Sub names.');
  }

  const resolved = await requireGmailWebhookBaseUrl();

  return {
    ...resolved,
    topicName: gmailTopicName(tenantId),
    subscriptionName: gmailSubscriptionName(tenantId),
    webhookUrl: buildGmailWebhookUrl(resolved.baseUrl),
  };
}
