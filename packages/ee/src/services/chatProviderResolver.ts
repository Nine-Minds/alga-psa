import OpenAI from 'openai';
import { GoogleAuth } from 'google-auth-library';

import { getSecret } from '@alga-psa/core/secrets';
import { isSelfHostLicensing } from '@alga-psa/licensing';
// LEVERAGE: friction duplicated-chat-provider-resolver — this file duplicates
// ee/server/src/services/chatProviderResolver.ts (and now deep-imports the
// aiGateway client across package boundaries); the resolver + gateway client
// belong in one shared package consumed by both.
import { resolveGatewayAuthToken } from '../../../../ee/server/src/lib/aiGateway/client';
import type { AiFeature } from '../../../../ee/server/src/lib/aiGateway/types';
import { isAiUsageBillingEnabled } from './aiGatewayRollout';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'minimax/minimax-m2';
const VERTEX_DEFAULT_MODEL = 'zai-org/glm-5-maas';
const VERTEX_AUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const VERTEX_PLACEHOLDER_API_KEY = 'vertex-managed-access-token';

let googleAuthClient: GoogleAuth | null = null;

export type ChatProviderId = 'gateway' | 'openrouter' | 'vertex';

export type ChatProviderRequestOverrides = {
  resolveTurnOverrides: () => Record<string, unknown>;
};

export type ResolvedChatProvider = {
  providerId: ChatProviderId;
  model: string;
  client: OpenAI;
  requestOverrides: ChatProviderRequestOverrides;
};

const normalizeProvider = (providerValue: unknown): ChatProviderId => {
  const value = typeof providerValue === 'string' ? providerValue.trim().toLowerCase() : '';
  if (value === 'vertex') {
    return 'vertex';
  }
  if (value === 'gateway') {
    return 'gateway';
  }
  return 'openrouter';
};

const trimString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readSecret = async (key: string): Promise<string | undefined> => {
  return trimString(await getSecret(key, key, ''));
};

const featureHeaders = (feature: AiFeature): Record<string, string> => ({
  'X-Alga-AI-Feature': feature,
});

const getGoogleAuth = (): GoogleAuth => {
  if (!googleAuthClient) {
    googleAuthClient = new GoogleAuth({
      scopes: [VERTEX_AUTH_SCOPE],
    });
  }
  return googleAuthClient;
};

const readGoogleCloudAccessToken = async (): Promise<string | undefined> => {
  const auth = getGoogleAuth();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token =
    typeof tokenResponse === 'string'
      ? tokenResponse
      : tokenResponse?.token;
  return trimString(token);
};

const resolveVertexBaseUrl = ({
  explicitBaseUrl,
  projectId,
  location,
}: {
  explicitBaseUrl?: string;
  projectId?: string;
  location?: string;
}): string => {
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/, '');
  }

  if (!projectId || !location) {
    throw new Error(
      'Vertex provider is missing configuration. Set VERTEX_OPENAPI_BASE_URL or both VERTEX_PROJECT_ID and VERTEX_LOCATION.',
    );
  }

  const normalizedProject = projectId.trim();
  const normalizedLocation = location.trim();
  const host =
    normalizedLocation.toLowerCase() === 'global'
      ? 'aiplatform.googleapis.com'
      : `${normalizedLocation}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${normalizedProject}/locations/${normalizedLocation}/endpoints/openapi`;
};

const resolveOpenRouterProvider = async (feature: AiFeature): Promise<ResolvedChatProvider> => {
  const apiKey = await readSecret('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured');
  }

  return {
    providerId: 'openrouter',
    model: (await readSecret('OPENROUTER_CHAT_MODEL')) ?? OPENROUTER_DEFAULT_MODEL,
    client: new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: featureHeaders(feature),
    }),
    requestOverrides: {
      resolveTurnOverrides: () => ({}),
    },
  };
};

const resolveVertexProvider = async (feature: AiFeature): Promise<ResolvedChatProvider> => {
  const explicitBaseUrl = await readSecret('VERTEX_OPENAPI_BASE_URL');
  const projectId = await readSecret('VERTEX_PROJECT_ID');
  const location = await readSecret('VERTEX_LOCATION');
  const baseURL = resolveVertexBaseUrl({ explicitBaseUrl, projectId, location });
  const configuredModel = await readSecret('VERTEX_CHAT_MODEL');
  const model =
    configuredModel === 'glm-5-maas'
      ? 'zai-org/glm-5-maas'
      : configuredModel ?? VERTEX_DEFAULT_MODEL;

  const resolveBearerToken = async (): Promise<string> => {
    const refreshedToken = await readGoogleCloudAccessToken();
    if (refreshedToken) {
      return refreshedToken;
    }
    throw new Error('Vertex provider requires Google ADC credentials.');
  };

  return {
    providerId: 'vertex',
    model,
    client: new OpenAI({
      apiKey: VERTEX_PLACEHOLDER_API_KEY,
      baseURL,
      defaultHeaders: featureHeaders(feature),
      fetch: async (...args: unknown[]) => {
        const [input, init] = args as [RequestInfo | URL, RequestInit | undefined];
        const headers = new Headers(init?.headers ?? {});
        headers.set('Authorization', `Bearer ${await resolveBearerToken()}`);
        return fetch(input, {
          ...(init ?? {}),
          headers,
        });
      },
    }),
    requestOverrides: {
      resolveTurnOverrides: () => ({}),
    },
  };
};

const resolveGatewayProvider = async (
  gatewayUrl: string,
  tenantId: string | null | undefined,
  feature: AiFeature,
): Promise<ResolvedChatProvider> => {
  const normalizedTenantId = trimString(tenantId);
  if (!normalizedTenantId) {
    throw new Error('AI gateway provider requires a tenant id');
  }

  return {
    providerId: 'gateway',
    model:
      (await readSecret('AI_GATEWAY_MODEL')) ??
      (await readSecret('OPENROUTER_CHAT_MODEL')) ??
      OPENROUTER_DEFAULT_MODEL,
    client: new OpenAI({
      apiKey: await resolveGatewayAuthToken(normalizedTenantId),
      baseURL: `${gatewayUrl.replace(/\/+$/, '')}/v1`,
      defaultHeaders: featureHeaders(feature),
    }),
    requestOverrides: {
      resolveTurnOverrides: () => ({}),
    },
  };
};

export async function resolveChatProvider(
  tenantId: string | null | undefined,
  feature: AiFeature,
  providerOverride?: ChatProviderId,
): Promise<ResolvedChatProvider> {
  const gatewayUrl = trimString(process.env.AI_GATEWAY_URL);
  const gatewayBypassed = process.env.AI_GATEWAY_BYPASS === 'true';
  if (!providerOverride && gatewayUrl && !gatewayBypassed) {
    const normalizedTenantId = trimString(tenantId);
    if (!normalizedTenantId) {
      throw new Error('AI gateway provider requires a tenant id');
    }
    const selfHosted = await isSelfHostLicensing();
    if (selfHosted || (await isAiUsageBillingEnabled(normalizedTenantId))) {
      return resolveGatewayProvider(gatewayUrl, normalizedTenantId, feature);
    }
    // Tenant not in the ai-usage-billing rollout: legacy direct-provider path.
  }

  let providerId = normalizeProvider(providerOverride ?? process.env.AI_CHAT_PROVIDER);
  if (providerId === 'gateway') {
    if (!gatewayBypassed) {
      if (!gatewayUrl) {
        throw new Error('Gateway provider is missing configuration. Set AI_GATEWAY_URL.');
      }
      return resolveGatewayProvider(gatewayUrl, tenantId, feature);
    }
    providerId = 'openrouter';
  }

  if (providerId === 'vertex') {
    return resolveVertexProvider(feature);
  }

  return resolveOpenRouterProvider(feature);
}
