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

export interface SendBotActivityInput {
  serviceUrl: string;
  conversationId: string;
  replyToId?: string | null;
  activity: TeamsBotResponseActivity;
}

export interface SendBotActivityResult {
  status: 'sent' | 'skipped';
  reason?: string;
}

export async function sendBotActivity(input: SendBotActivityInput): Promise<SendBotActivityResult> {
  const credentials = readBotCredentialsFromEnv();
  if (!credentials) {
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

  const token = await getAccessToken(credentials);

  const base = input.serviceUrl.endsWith('/') ? input.serviceUrl.slice(0, -1) : input.serviceUrl;
  const conversation = encodeURIComponent(input.conversationId);
  const url = input.replyToId
    ? `${base}/v3/conversations/${conversation}/activities/${encodeURIComponent(input.replyToId)}`
    : `${base}/v3/conversations/${conversation}/activities`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.activity),
  });

  if (response.status === 401) {
    // Token likely expired between cache check and request. Clear the cache
    // so the next send forces a fresh token, then surface the error.
    cachedToken = null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Failed to send Bot Framework activity (${response.status} ${response.statusText}): ${detail.slice(0, 200)}`
    );
  }

  return { status: 'sent' };
}
