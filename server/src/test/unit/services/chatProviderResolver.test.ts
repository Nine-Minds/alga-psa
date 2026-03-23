import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openAiConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const getSecretMock = vi.hoisted(() => vi.fn());
const googleAccessTokenState = vi.hoisted(() => ({ token: 'adc-token' as string | undefined }));

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
  getSecret: getSecretMock,
}));

vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    constructor(_config: unknown) {}

    async getClient() {
      return {
        getAccessToken: async () =>
          googleAccessTokenState.token
            ? { token: googleAccessTokenState.token }
            : null,
      };
    }
  },
}));

const MANAGED_ENV_KEYS = [
  'AI_CHAT_PROVIDER',
  'GOOGLE_CLOUD_ACCESS_TOKEN',
  'OPENROUTER_API_KEY',
  'OPENROUTER_CHAT_MODEL',
  'VERTEX_PROJECT_ID',
  'VERTEX_LOCATION',
  'VERTEX_CHAT_MODEL',
  'VERTEX_OPENAPI_BASE_URL',
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
  getSecretMock.mockImplementation(
    async (secretName: string, envVar: string, defaultValue: string = '') => {
      const secretValue = values[secretName];
      if (secretValue !== undefined) {
        return secretValue;
      }

      const envValue = process.env[envVar];
      return envValue ?? defaultValue;
    },
  );
};

describe('resolveChatProvider()', () => {
  beforeEach(() => {
    vi.resetModules();
    getSecretMock.mockReset();
    openAiConfigs.splice(0, openAiConfigs.length);
    resetManagedEnv();
    googleAccessTokenState.token = 'adc-token';
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
      VERTEX_PROJECT_ID: 'proj-123',
      VERTEX_LOCATION: 'us-central1',
      VERTEX_CHAT_MODEL: 'glm-5-maas-custom',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const provider = await resolveChatProvider();

    expect(provider.providerId).toBe('vertex');
    expect(provider.model).toBe('glm-5-maas-custom');
    expect(openAiConfigs.at(-1)).toMatchObject({
      apiKey: 'vertex-managed-access-token',
      baseURL:
        'https://us-central1-aiplatform.googleapis.com/v1/projects/proj-123/locations/us-central1/endpoints/openapi',
    });
  });

  it('uses ADC token flow for Vertex requests', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      VERTEX_PROJECT_ID: 'proj-adc',
      VERTEX_LOCATION: 'us-central1',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const provider = await resolveChatProvider();

    expect(provider.providerId).toBe('vertex');
    expect(openAiConfigs.at(-1)).toMatchObject({
      apiKey: 'vertex-managed-access-token',
    });
    expect(typeof openAiConfigs.at(-1)?.fetch).toBe('function');
  });

  it('uses configured Google access token for Vertex requests when present', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      GOOGLE_CLOUD_ACCESS_TOKEN: 'configured-token',
      VERTEX_PROJECT_ID: 'proj-configured',
      VERTEX_LOCATION: 'global',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');
    await resolveChatProvider();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await (openAiConfigs.at(-1)?.fetch as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)(
      'https://example.invalid/chat/completions',
      { method: 'POST', headers: {} },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.any(Headers),
    });
    expect(
      (fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.headers instanceof Headers,
    ).toBe(true);
    expect(
      ((fetchSpy.mock.calls[0]?.[1] as RequestInit).headers as Headers).get('Authorization'),
    ).toBe('Bearer configured-token');
    fetchSpy.mockRestore();
  });

  it('retries Vertex request with ADC after a 401 from configured token', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      GOOGLE_CLOUD_ACCESS_TOKEN: 'stale-configured-token',
      VERTEX_PROJECT_ID: 'proj-retry',
      VERTEX_LOCATION: 'global',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');
    await resolveChatProvider();

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );

    const response = await (
      openAiConfigs.at(-1)?.fetch as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    )('https://example.invalid/chat/completions', {
      method: 'POST',
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(
      ((fetchSpy.mock.calls[0]?.[1] as RequestInit).headers as Headers).get('Authorization'),
    ).toBe('Bearer stale-configured-token');
    expect(
      ((fetchSpy.mock.calls[1]?.[1] as RequestInit).headers as Headers).get('Authorization'),
    ).toBe('Bearer adc-token');
    fetchSpy.mockRestore();
  });

  it('uses explicit VERTEX_OPENAPI_BASE_URL when provided', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
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
      VERTEX_PROJECT_ID: 'proj-derived',
      VERTEX_LOCATION: 'europe-west1',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    await resolveChatProvider();

    expect(openAiConfigs.at(-1)).toMatchObject({
      baseURL:
        'https://europe-west1-aiplatform.googleapis.com/v1/projects/proj-derived/locations/europe-west1/endpoints/openapi',
    });
  });

  it('throws from request fetch when ADC token is unavailable', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    googleAccessTokenState.token = undefined;
    setSecrets({
      VERTEX_PROJECT_ID: 'proj-missing-token',
      VERTEX_LOCATION: 'us-central1',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');
    const provider = await resolveChatProvider();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    await expect(
      (openAiConfigs.at(-1)?.fetch as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)(
        'https://example.invalid/chat/completions',
        { method: 'POST', headers: {} },
      ),
    ).rejects.toThrow('Vertex provider requires Google ADC credentials.');

    expect(provider.providerId).toBe('vertex');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does not include Vertex thinking override payload', async () => {
    process.env.AI_CHAT_PROVIDER = 'vertex';
    setSecrets({
      VERTEX_PROJECT_ID: 'proj-thinking-on',
      VERTEX_LOCATION: 'us-central1',
    });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const provider = await resolveChatProvider();
    expect(provider.requestOverrides.resolveTurnOverrides()).toEqual({});
  });

  it('never includes Vertex-specific thinking overrides for OpenRouter provider', async () => {
    process.env.AI_CHAT_PROVIDER = 'openrouter';
    setSecrets({ OPENROUTER_API_KEY: 'openrouter-key' });

    const { resolveChatProvider } = await import('@ee/services/chatProviderResolver');

    const provider = await resolveChatProvider();

    expect(provider.providerId).toBe('openrouter');
    expect(provider.requestOverrides.resolveTurnOverrides()).toEqual({});
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
