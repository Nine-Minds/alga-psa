import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openAiConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const getSecretProviderInstanceMock = vi.hoisted(() => vi.fn());

vi.mock('openai', () => {
  class OpenAI {
    chat = {
      completions: {
        create: vi.fn(),
      },
    };

    constructor(config: Record<string, unknown>) {
      openAiConfigs.push(config);
    }
  }

  return { default: OpenAI };
});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: getSecretProviderInstanceMock,
}));

const MANAGED_ENV_KEYS = [
  'AI_CHAT_PROVIDER',
  'OPENROUTER_API_KEY',
  'OPENROUTER_CHAT_MODEL',
  'GOOGLE_CLOUD_ACCESS_TOKEN',
  'VERTEX_ACCESS_TOKEN',
  'VERTEX_PROJECT_ID',
  'VERTEX_LOCATION',
  'VERTEX_CHAT_MODEL',
  'VERTEX_OPENAPI_BASE_URL',
  'VERTEX_ENABLE_THINKING',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = Object.fromEntries(
  MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]),
);

const resetManagedEnv = () => {
  for (const key of MANAGED_ENV_KEYS) {
    const originalValue = ORIGINAL_ENV[key];
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
};

const setSecrets = (values: Record<string, string | undefined>) => {
  getSecretProviderInstanceMock.mockResolvedValue({
    getAppSecret: vi.fn(async (key: string) => values[key] ?? null),
  });
};

describe('resolveChatProvider()', () => {
  beforeEach(() => {
    vi.resetModules();
    getSecretProviderInstanceMock.mockReset();
    openAiConfigs.splice(0, openAiConfigs.length);
    resetManagedEnv();
  });

  afterEach(() => {
    resetManagedEnv();
  });

  it('defaults to openrouter when AI_CHAT_PROVIDER is missing', async () => {
    delete process.env.AI_CHAT_PROVIDER;
    setSecrets({ OPENROUTER_API_KEY: 'openrouter-secret' });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const provider = await resolveChatProvider();

    expect(provider.providerId).toBe('openrouter');
    expect(provider.model).toBe('minimax/minimax-m2');
    expect(openAiConfigs.at(-1)).toMatchObject({
      apiKey: 'openrouter-secret',
      baseURL: 'https://openrouter.ai/api/v1',
    });
  });

  it('returns OpenRouter client/model when OpenRouter config is present', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_CHAT_MODEL: 'openrouter/custom-model',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const provider = await resolveChatProvider();

    expect(provider.providerId).toBe('openrouter');
    expect(provider.model).toBe('openrouter/custom-model');
    expect(openAiConfigs.at(-1)).toMatchObject({
      apiKey: 'openrouter-key',
      baseURL: 'https://openrouter.ai/api/v1',
    });
  });

  it('returns Vertex client/model when AI_CHAT_PROVIDER=vertex and required config exists', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      GOOGLE_CLOUD_ACCESS_TOKEN: 'vertex-token',
      VERTEX_PROJECT_ID: 'proj-123',
      VERTEX_LOCATION: 'us-central1',
      VERTEX_CHAT_MODEL: 'glm-5-maas-custom',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const provider = await resolveChatProvider();

    expect(provider.providerId).toBe('vertex');
    expect(provider.model).toBe('glm-5-maas-custom');
    expect(openAiConfigs.at(-1)).toMatchObject({
      apiKey: 'vertex-token',
      baseURL:
        'https://us-central1-aiplatform.googleapis.com/v1beta1/projects/proj-123/locations/us-central1/endpoints/openapi',
    });
  });

  it('uses explicit VERTEX_OPENAPI_BASE_URL when provided', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      GOOGLE_CLOUD_ACCESS_TOKEN: 'vertex-token',
      VERTEX_OPENAPI_BASE_URL: 'https://example.invalid/custom/openapi///',
      VERTEX_PROJECT_ID: 'ignored-proj',
      VERTEX_LOCATION: 'ignored-location',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    await resolveChatProvider();

    expect(openAiConfigs.at(-1)).toMatchObject({
      baseURL: 'https://example.invalid/custom/openapi',
    });
  });

  it('derives Vertex base URL from VERTEX_PROJECT_ID and VERTEX_LOCATION when explicit URL is absent', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      GOOGLE_CLOUD_ACCESS_TOKEN: 'vertex-token',
      VERTEX_PROJECT_ID: 'proj-derived',
      VERTEX_LOCATION: 'europe-west1',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    await resolveChatProvider();

    expect(openAiConfigs.at(-1)).toMatchObject({
      baseURL:
        'https://europe-west1-aiplatform.googleapis.com/v1beta1/projects/proj-derived/locations/europe-west1/endpoints/openapi',
    });
  });

  it('returns clear error when required Vertex access token is missing', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      VERTEX_PROJECT_ID: 'proj-missing-token',
      VERTEX_LOCATION: 'us-central1',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    await expect(resolveChatProvider()).rejects.toThrow(
      'Vertex provider requires GOOGLE_CLOUD_ACCESS_TOKEN (or VERTEX_ACCESS_TOKEN).',
    );
  });

  it('does not include thinking override payload when VERTEX_ENABLE_THINKING is true or unset', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      GOOGLE_CLOUD_ACCESS_TOKEN: 'vertex-token',
      VERTEX_PROJECT_ID: 'proj-thinking-on',
      VERTEX_LOCATION: 'us-central1',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const defaultProvider = await resolveChatProvider();
    expect(defaultProvider.requestOverrides.resolveTurnOverrides()).toEqual({});

    process.env.VERTEX_ENABLE_THINKING = 'true';
    const explicitTrueProvider = await resolveChatProvider();
    expect(explicitTrueProvider.requestOverrides.resolveTurnOverrides()).toEqual({});
  });

  it('includes turn-level thinking disable payload when VERTEX_ENABLE_THINKING=false', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    process.env.VERTEX_ENABLE_THINKING = 'false';
    setSecrets({
      GOOGLE_CLOUD_ACCESS_TOKEN: 'vertex-token',
      VERTEX_PROJECT_ID: 'proj-thinking-off',
      VERTEX_LOCATION: 'us-central1',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const provider = await resolveChatProvider();

    expect(provider.requestOverrides.resolveTurnOverrides()).toEqual({
      extra_body: {
        thinking: { enabled: false },
      },
    });
  });

  it('never includes Vertex-specific thinking overrides for OpenRouter provider', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    process.env.VERTEX_ENABLE_THINKING = 'false';
    setSecrets({ OPENROUTER_API_KEY: 'openrouter-key' });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const provider = await resolveChatProvider();

    expect(provider.providerId).toBe('openrouter');
    expect(provider.requestOverrides.resolveTurnOverrides({ disableThinking: true })).toEqual({});
  });

  it('falls back to OpenRouter when AI_CHAT_PROVIDER has an unknown value', async () => {
    process.env.AI_CHAT_PROVIDER = 'unknown-provider';
    setSecrets({ OPENROUTER_API_KEY: 'openrouter-key' });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const provider = await resolveChatProvider();

    expect(provider.providerId).toBe('openrouter');
    expect(openAiConfigs.at(-1)).toMatchObject({
      baseURL: 'https://openrouter.ai/api/v1',
    });
  });
});
