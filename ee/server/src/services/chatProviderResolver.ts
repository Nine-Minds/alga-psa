import OpenAI from 'openai';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'minimax/minimax-m2';
const VERTEX_DEFAULT_MODEL = 'glm-5-maas';
const FALSE_LIKE_VALUES = new Set(['0', 'false', 'no', 'off']);

export type ChatProviderId = 'openrouter' | 'vertex';

type TurnOptions = {
  disableThinking?: boolean;
};

export type ChatProviderRequestOverrides = {
  resolveTurnOverrides: (options?: TurnOptions) => Record<string, unknown>;
};

export type ResolvedChatProvider = {
  providerId: ChatProviderId;
  model: string;
  client: OpenAI;
  requestOverrides: ChatProviderRequestOverrides;
};

type SecretProviderLike = {
  getAppSecret: (key: string) => Promise<string | null | undefined>;
};

const normalizeProvider = (providerValue: unknown): ChatProviderId => {
  const value = typeof providerValue === 'string' ? providerValue.trim().toLowerCase() : '';
  if (value === 'vertex') {
    return 'vertex';
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

const readSecretOrEnv = async (
  secretProvider: SecretProviderLike,
  key: string,
  aliases: string[] = [],
): Promise<string | undefined> => {
  const candidates = [key, ...aliases];
  for (const candidate of candidates) {
    const fromSecret = trimString(await secretProvider.getAppSecret(candidate));
    if (fromSecret) {
      return fromSecret;
    }

    const fromEnv = trimString(process.env[candidate]);
    if (fromEnv) {
      return fromEnv;
    }
  }

  return undefined;
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
  return `https://${normalizedLocation}-aiplatform.googleapis.com/v1beta1/projects/${normalizedProject}/locations/${normalizedLocation}/endpoints/openapi`;
};

const resolveOpenRouterProvider = async (
  secretProvider: SecretProviderLike,
): Promise<ResolvedChatProvider> => {
  const apiKey = await readSecretOrEnv(secretProvider, 'OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OpenRouter API key is not configured');
  }

  return {
    providerId: 'openrouter',
    model:
      (await readSecretOrEnv(secretProvider, 'OPENROUTER_CHAT_MODEL')) ??
      OPENROUTER_DEFAULT_MODEL,
    client: new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
    }),
    requestOverrides: {
      resolveTurnOverrides: () => ({}),
    },
  };
};

const resolveVertexProvider = async (
  secretProvider: SecretProviderLike,
): Promise<ResolvedChatProvider> => {
  const accessToken = await readSecretOrEnv(secretProvider, 'GOOGLE_CLOUD_ACCESS_TOKEN', [
    'VERTEX_ACCESS_TOKEN',
  ]);
  if (!accessToken) {
    throw new Error(
      'Vertex provider requires GOOGLE_CLOUD_ACCESS_TOKEN (or VERTEX_ACCESS_TOKEN).',
    );
  }

  const explicitBaseUrl = await readSecretOrEnv(secretProvider, 'VERTEX_OPENAPI_BASE_URL');
  const projectId = await readSecretOrEnv(secretProvider, 'VERTEX_PROJECT_ID');
  const location = await readSecretOrEnv(secretProvider, 'VERTEX_LOCATION');
  const baseURL = resolveVertexBaseUrl({ explicitBaseUrl, projectId, location });

  const thinkingFlag = trimString(process.env.VERTEX_ENABLE_THINKING)?.toLowerCase();
  const disableThinkingFromEnv = thinkingFlag
    ? FALSE_LIKE_VALUES.has(thinkingFlag)
    : false;

  return {
    providerId: 'vertex',
    model:
      (await readSecretOrEnv(secretProvider, 'VERTEX_CHAT_MODEL')) ??
      VERTEX_DEFAULT_MODEL,
    client: new OpenAI({
      apiKey: accessToken,
      baseURL,
    }),
    requestOverrides: {
      resolveTurnOverrides: (options = {}) => {
        const disableThinking = options.disableThinking ?? disableThinkingFromEnv;
        if (!disableThinking) {
          return {};
        }
        return {
          extra_body: {
            thinking: { enabled: false },
          },
        };
      },
    },
  };
};

export async function resolveChatProvider(
  providerOverride?: ChatProviderId,
): Promise<ResolvedChatProvider> {
  const secretProvider = (await getSecretProviderInstance()) as SecretProviderLike;
  const providerId = normalizeProvider(providerOverride ?? process.env.AI_CHAT_PROVIDER);
  if (providerId === 'vertex') {
    return resolveVertexProvider(secretProvider);
  }

  return resolveOpenRouterProvider(secretProvider);
}
