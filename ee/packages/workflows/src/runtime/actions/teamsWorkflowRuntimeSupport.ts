import { getSecretProviderInstance } from '@alga-psa/core/secrets';

// Self-contained Teams support for workflow actions. The workflows package
// cannot depend on @alga-psa/ee-microsoft-teams (that package depends on
// @alga-psa/workflows — circular — and its exports map to TS source, which
// the workflows dist cannot load at runtime), so the Graph and Bot Framework
// calls are replicated here following the same conventions.

export type TeamsActivityType =
  | 'assignmentCreated'
  | 'customerReplyReceived'
  | 'approvalRequested'
  | 'workEscalated'
  | 'slaRiskDetected';

export type TeamsIntegrationContext = {
  appId: string;
  baseUrl: string;
  profile: {
    clientId: string;
    tenantAuthority: string;
    clientSecretRef: string;
  };
};

const TEAMS_PERSONAL_TAB_ENTITY_ID = 'alga-psa-personal-tab';

// Bot Framework service URLs use known Microsoft-operated hosts; never send a
// bot token to broad cloud-hosting suffixes that non-Microsoft tenants can own.
const TRUSTED_SERVICE_URL_HOSTS = new Set(['smba.trafficmanager.net']);
const TRUSTED_SERVICE_URL_SUFFIXES = ['.botframework.com', '.botplatform.cloudes.microsoft.com'];
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

let cachedBotToken: { accessToken: string; expiresAt: number } | null = null;

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function isTrustedServiceUrl(serviceUrl: string): boolean {
  try {
    const url = new URL(serviceUrl);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return (
      TRUSTED_SERVICE_URL_HOSTS.has(host) ||
      TRUSTED_SERVICE_URL_SUFFIXES.some((suffix) => host.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

export function readBotCredentialsFromEnv(): { appId: string; tenantId: string; password: string } | null {
  const appId = process.env.TEAMS_BOT_APP_ID?.trim();
  const tenantId = process.env.TEAMS_BOT_APP_TENANT_ID?.trim();
  const password = process.env.TEAMS_BOT_APP_PASSWORD?.trim();
  if (!appId || !tenantId || !password) return null;
  return { appId, tenantId, password };
}

async function getBotAccessToken(): Promise<string> {
  const credentials = readBotCredentialsFromEnv();
  if (!credentials) {
    throw new Error('Teams bot credentials are not configured (TEAMS_BOT_APP_ID / TEAMS_BOT_APP_TENANT_ID / TEAMS_BOT_APP_PASSWORD).');
  }
  if (cachedBotToken && cachedBotToken.expiresAt > Date.now()) {
    return cachedBotToken.accessToken;
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credentials.appId,
        client_secret: credentials.password,
        scope: 'https://api.botframework.com/.default'
      })
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Failed to acquire Bot Framework token (${response.status}): ${detail.slice(0, 200)}`);
  }
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error('Bot Framework token response did not include access_token.');
  }
  cachedBotToken = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 - TOKEN_EXPIRY_BUFFER_MS
  };
  return payload.access_token;
}

export async function fetchGraphAppToken(context: TeamsIntegrationContext, tenantId: string): Promise<string> {
  const secretProvider = await getSecretProviderInstance();
  const clientSecret = await secretProvider.getTenantSecret(tenantId, context.profile.clientSecretRef);
  if (!clientSecret) {
    throw new Error('Selected Teams Microsoft profile is missing the client secret required for Graph delivery.');
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(context.profile.tenantAuthority)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: context.profile.clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      })
    }
  );
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Failed to acquire Teams Graph token (${response.status}): ${errorBody || response.statusText}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  const accessToken = normalizeString(payload.access_token);
  if (!accessToken) {
    throw new Error('Microsoft token response did not include an access token.');
  }
  return accessToken;
}

// Same entity deep-link shape the Teams package builds for notifications;
// Graph requires topic.webUrl to be a Teams deep link when source is 'text'.
export function buildGenericTeamsDeepLink(baseUrl: string, appId: string, psaUrl?: string | null): string {
  const webUrl = normalizeString(psaUrl) || `${baseUrl.replace(/\/+$/, '')}/msp/dashboard`;
  const params = new URLSearchParams({
    webUrl,
    context: JSON.stringify({ page: 'my_work', source: 'notification' })
  });
  return `https://teams.microsoft.com/l/entity/${encodeURIComponent(appId)}/${encodeURIComponent(
    TEAMS_PERSONAL_TAB_ENTITY_ID
  )}?${params.toString()}`;
}

export class TeamsGraphApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TeamsGraphApiError';
    this.status = status;
  }
}

export async function sendActivityNotification(input: {
  graphToken: string;
  recipientAadId: string;
  activityType: TeamsActivityType;
  topicText: string;
  webUrl: string;
  previewText: string;
  itemName: string;
}): Promise<void> {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(input.recipientAadId)}/teamwork/sendActivityNotification`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.graphToken}`
      },
      body: JSON.stringify({
        topic: { source: 'text', value: input.topicText, webUrl: input.webUrl },
        activityType: input.activityType,
        previewText: { content: input.previewText },
        recipient: {
          '@odata.type': 'microsoft.graph.aadUserNotificationRecipient',
          userId: input.recipientAadId
        },
        templateParameters: [{ name: 'item', value: input.itemName }]
      })
    }
  );
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new TeamsGraphApiError(
      `Teams activity notification delivery failed (${response.status}): ${errorBody || response.statusText}`,
      response.status
    );
  }
}

export class TeamsBotApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TeamsBotApiError';
    this.status = status;
  }
}

const botRequest = async (url: string, body: unknown): Promise<unknown> => {
  const token = await getBotAccessToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (response.status === 401) {
    cachedBotToken = null;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new TeamsBotApiError(
      `Bot Framework request failed (${response.status} ${response.statusText}): ${detail.slice(0, 200)}`,
      response.status
    );
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export async function sendConversationMessage(input: {
  serviceUrl: string;
  conversationId: string;
  text: string;
}): Promise<{ activityId: string | null }> {
  if (!isTrustedServiceUrl(input.serviceUrl)) {
    throw new TeamsBotApiError(`Untrusted Teams service URL: ${input.serviceUrl}`);
  }
  const base = input.serviceUrl.replace(/\/+$/, '');
  const data = (await botRequest(
    `${base}/v3/conversations/${encodeURIComponent(input.conversationId)}/activities`,
    { type: 'message', text: input.text }
  )) as { id?: string } | null;
  return { activityId: data?.id ? String(data.id) : null };
}

export async function createChannelConversation(input: {
  serviceUrl: string;
  channelId: string;
  text: string;
}): Promise<{ conversationId: string | null; activityId: string | null }> {
  if (!isTrustedServiceUrl(input.serviceUrl)) {
    throw new TeamsBotApiError(`Untrusted Teams service URL: ${input.serviceUrl}`);
  }
  const credentials = readBotCredentialsFromEnv();
  const base = input.serviceUrl.replace(/\/+$/, '');
  const data = (await botRequest(`${base}/v3/conversations`, {
    isGroup: true,
    channelData: { channel: { id: input.channelId } },
    ...(credentials ? { bot: { id: `28:${credentials.appId}` } } : {}),
    activity: { type: 'message', text: input.text }
  })) as { id?: string; activityId?: string } | null;
  return {
    conversationId: data?.id ? String(data.id) : null,
    activityId: data?.activityId ? String(data.activityId) : null
  };
}
