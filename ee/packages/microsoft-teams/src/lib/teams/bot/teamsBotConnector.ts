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

export function isTrustedServiceUrl(serviceUrl: string): boolean {
  try {
    const url = new URL(serviceUrl);
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
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
    credentials.tenantId
  )}/oauth2/v2.0/token`;

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

  const token = await getAccessToken(credentials);
  const response = await fetch(params.url, {
    method: params.method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params.activity),
  });

  if (response.status === 401) {
    // Token likely expired between cache check and request. Clear the cache
    // so the next send forces a fresh token, then surface the error.
    cachedToken = null;
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
