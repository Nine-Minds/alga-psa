import { isTeamsEmulatorModeEnabled } from '../emulatorMode';
import { getMicrosoftTokenUrl } from '../microsoftEndpoints';
import type { TeamsBotResponseActivity } from './teamsBotHandler';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface BotCredentials {
  appId: string;
  tenantId: string;
  password: string;
}

// Bot Framework service URLs are issued by Microsoft and all live under a
// small set of trusted hostname suffixes. Before sending a bearer token to a
// serviceUrl we got out of an inbound activity, sanity-check that it looks
// like a real Bot Framework endpoint so we never leak the token to an
// attacker-controlled URL even if inbound validation is bypassed somehow.
const TRUSTED_SERVICE_URL_SUFFIXES = [
  '.botframework.com',
  '.trafficmanager.net',
  '.botplatform.cloudes.microsoft.com',
];

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

let cachedToken: CachedToken | null = null;
let inFlightTokenRequest: Promise<string> | null = null;

export function readBotCredentialsFromEnv(): BotCredentials | null {
  const appId = process.env.TEAMS_BOT_APP_ID?.trim();
  const tenantId = process.env.TEAMS_BOT_APP_TENANT_ID?.trim();
  const password = process.env.TEAMS_BOT_APP_PASSWORD?.trim();
  if (!appId || !tenantId || !password) {
    return null;
  }
  return { appId, tenantId, password };
}

export function isBotConnectorConfigured(): boolean {
  return readBotCredentialsFromEnv() !== null;
}

const EMPTY_ALLOWLIST: ReadonlySet<string> = new Set();

let allowlistCache: { raw: string; origins: ReadonlySet<string> } | null = null;

/**
 * A scheme-less entry such as `localhost:4010` still parses — as protocol
 * `localhost:` with the opaque origin "null". Admitting "null" to the trust set
 * would trust every opaque-origin serviceUrl, so only real http(s) origins are
 * accepted and anything else is rejected loudly.
 */
function parseAllowlistOrigin(entry: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(entry);
  } catch {
    return null;
  }
  if (parsed.origin === 'null' || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return null;
  }
  return parsed.origin.toLowerCase();
}

/**
 * Extra serviceUrl origins trusted when the emulator gate is explicitly on, for
 * pointing the bot at a local emulator (algasim). Exact origins only,
 * comma-separated, no wildcards. Unset — the default — leaves the trust list
 * byte-identical to the Microsoft-only allowlist above.
 */
function developmentServiceUrlAllowlist(): ReadonlySet<string> {
  if (!isTeamsEmulatorModeEnabled()) {
    return EMPTY_ALLOWLIST;
  }
  const raw = process.env.TEAMS_BOT_SERVICE_URL_ALLOWLIST?.trim();
  if (!raw) {
    return EMPTY_ALLOWLIST;
  }
  // Parsed once per distinct value so a rejected entry is not re-logged on
  // every send.
  if (allowlistCache?.raw === raw) {
    return allowlistCache.origins;
  }
  const origins = new Set<string>();
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const origin = parseAllowlistOrigin(trimmed);
    if (!origin) {
      console.warn(
        '[teams-bot] ignoring TEAMS_BOT_SERVICE_URL_ALLOWLIST entry that is not an exact http(s) origin',
        { entry: trimmed }
      );
      continue;
    }
    origins.add(origin);
  }
  allowlistCache = { raw, origins };
  return origins;
}

export function isTrustedServiceUrl(serviceUrl: string): boolean {
  try {
    const url = new URL(serviceUrl);
    // An opaque origin can never match an allowlist entry, and must not be
    // compared as the literal string "null".
    if (url.origin !== 'null' && developmentServiceUrlAllowlist().has(url.origin.toLowerCase())) {
      return true;
    }
    if (url.protocol !== 'https:') {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return TRUSTED_SERVICE_URL_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

async function fetchAccessToken(credentials: BotCredentials): Promise<string> {
  const tokenUrl = getMicrosoftTokenUrl(credentials.tenantId);

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.appId,
    client_secret: credentials.password,
    scope: 'https://api.botframework.com/.default',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Failed to acquire Bot Framework token (${response.status} ${response.statusText}): ${detail.slice(0, 200)}`
    );
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  if (!payload.access_token) {
    throw new Error('Bot Framework token response did not include access_token.');
  }

  const lifetimeMs = (payload.expires_in ?? 3600) * 1000;
  cachedToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + lifetimeMs - TOKEN_EXPIRY_BUFFER_MS,
  };
  return payload.access_token;
}

async function getAccessToken(credentials: BotCredentials): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  if (inFlightTokenRequest) {
    return inFlightTokenRequest;
  }
  inFlightTokenRequest = fetchAccessToken(credentials).finally(() => {
    inFlightTokenRequest = null;
  });
  return inFlightTokenRequest;
}

/**
 * Wire activity accepted by the connector: a bot response activity or any
 * hand-built activity shape (e.g. proactive welcome cards with Adaptive
 * Card attachments).
 */
export type BotConnectorActivity = TeamsBotResponseActivity | Record<string, unknown>;

export interface SendBotActivityInput {
  serviceUrl: string;
  conversationId: string;
  replyToId?: string | null;
  activity: BotConnectorActivity;
}

export interface SendBotActivityResult {
  status: 'sent' | 'skipped';
  reason?: string;
}

/** Connector request failure carrying the HTTP status for retry decisions. */
export class BotConnectorRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BotConnectorRequestError';
    this.status = status;
  }
}

async function dispatchBotConnectorRequest(params: {
  method: 'POST' | 'PUT';
  url: string;
  activity: BotConnectorActivity;
  operation: string;
}): Promise<void> {
  const credentials = readBotCredentialsFromEnv();
  if (!credentials) {
    throw new Error('Bot Framework credentials are not configured.');
  }

  const body = JSON.stringify(params.activity);
  const attempt = async (): Promise<Response> => {
    const token = await getAccessToken(credentials);
    return fetch(params.url, {
      method: params.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    });
  };

  let response = await attempt();

  // A 401 means the cached token expired between the cache check and the
  // request, which says nothing about the activity itself. Drop the token and
  // replay the same request once with a fresh one, here rather than at each
  // call site so every caller — bot replies, DM notifications, the proactive
  // welcome card, the diagnostics test send — survives an expiry identically.
  // A second 401 is a real credential problem and is surfaced.
  if (response.status === 401) {
    cachedToken = null;
    // Drain the discarded body so the connection is released before the replay.
    await response.text().catch(() => '');
    response = await attempt();
    if (response.status === 401) {
      cachedToken = null;
    }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new BotConnectorRequestError(
      `Failed to ${params.operation} Bot Framework activity (${response.status} ${response.statusText}): ${detail.slice(0, 200)}`,
      response.status
    );
  }
}

function buildConversationBaseUrl(serviceUrl: string, conversationId: string): string {
  const base = serviceUrl.endsWith('/') ? serviceUrl.slice(0, -1) : serviceUrl;
  return `${base}/v3/conversations/${encodeURIComponent(conversationId)}`;
}

function checkBotConnectorPreconditions(input: {
  serviceUrl: string;
  conversationId: string;
}): SendBotActivityResult | null {
  if (!readBotCredentialsFromEnv()) {
    return {
      status: 'skipped',
      reason: 'teams_bot_credentials_not_configured',
    };
  }

  if (!input.serviceUrl || !input.conversationId) {
    return {
      status: 'skipped',
      reason: 'missing_service_url_or_conversation_id',
    };
  }

  if (!isTrustedServiceUrl(input.serviceUrl)) {
    return {
      status: 'skipped',
      reason: 'untrusted_service_url',
    };
  }

  return null;
}

export async function sendBotActivity(input: SendBotActivityInput): Promise<SendBotActivityResult> {
  const skipped = checkBotConnectorPreconditions(input);
  if (skipped) {
    return skipped;
  }

  const base = buildConversationBaseUrl(input.serviceUrl, input.conversationId);
  const url = input.replyToId
    ? `${base}/activities/${encodeURIComponent(input.replyToId)}`
    : `${base}/activities`;

  await dispatchBotConnectorRequest({
    method: 'POST',
    url,
    activity: input.activity,
    operation: 'send',
  });

  return { status: 'sent' };
}

export interface UpdateBotActivityInput {
  serviceUrl: string;
  conversationId: string;
  activityId: string;
  activity: BotConnectorActivity;
}

/** Update an existing activity in place (PUT), e.g. refresh a card after an inline action. */
export async function updateBotActivity(input: UpdateBotActivityInput): Promise<SendBotActivityResult> {
  const skipped = checkBotConnectorPreconditions(input);
  if (skipped) {
    return skipped;
  }

  if (!input.activityId) {
    return {
      status: 'skipped',
      reason: 'missing_activity_id',
    };
  }

  const base = buildConversationBaseUrl(input.serviceUrl, input.conversationId);
  await dispatchBotConnectorRequest({
    method: 'PUT',
    url: `${base}/activities/${encodeURIComponent(input.activityId)}`,
    activity: input.activity,
    operation: 'update',
  });

  return { status: 'sent' };
}
