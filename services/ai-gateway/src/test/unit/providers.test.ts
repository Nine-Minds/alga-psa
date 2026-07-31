import { describe, expect, it, vi } from 'vitest';

import {
  EnvironmentProviderRouter,
  parseModelRoutes,
} from '../../providers/router.js';
import type { ProviderId, UpstreamProvider } from '../../providers/types.js';
import {
  resolveVertexBaseUrl,
  VertexProvider,
  type VertexAccessTokenProvider,
} from '../../providers/vertex.js';

function testProvider(id: ProviderId): UpstreamProvider {
  return {
    id,
    createChatCompletion: async () => new Response(null, { status: 200 }),
  };
}

describe('provider routing', () => {
  it('uses the most specific matching model route and the configured default', () => {
    const openrouter = testProvider('openrouter');
    const vertex = testProvider('vertex');
    const router = new EnvironmentProviderRouter({
      routes: parseModelRoutes(
        JSON.stringify({ '*': 'openrouter', 'gemini-*': 'vertex', 'gemini-2.5-*': 'openrouter' }),
      ),
      defaultProviderId: 'vertex',
      providers: { openrouter, vertex },
    });

    expect(router.resolve('gemini-2.5-pro')).toBe(openrouter);
    expect(router.resolve('gemini-2.0-flash')).toBe(vertex);
    expect(router.resolve('unmatched-model')).toBe(openrouter);

    const noRoutes = new EnvironmentProviderRouter({
      routes: [],
      defaultProviderId: 'vertex',
      providers: { openrouter, vertex },
    });
    expect(noRoutes.resolve('unmatched-model')).toBe(vertex);
  });

  it('rejects invalid route configuration at startup', () => {
    expect(() => parseModelRoutes('{')).toThrow('must be valid JSON');
    expect(() => parseModelRoutes(JSON.stringify({ '*': 'unknown' }))).toThrow(
      'must be openrouter or vertex',
    );
  });
});

describe('Vertex provider', () => {
  it('constructs regional, global, and explicit OpenAI-compatible base URLs', () => {
    expect(
      resolveVertexBaseUrl({ projectId: 'project-one', location: 'us-central1' }),
    ).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/project-one/locations/us-central1/endpoints/openapi',
    );
    expect(resolveVertexBaseUrl({ projectId: 'project-one', location: 'global' })).toBe(
      'https://aiplatform.googleapis.com/v1/projects/project-one/locations/global/endpoints/openapi',
    );
    expect(resolveVertexBaseUrl({ explicitBaseUrl: 'https://vertex.example.test/v1/' })).toBe(
      'https://vertex.example.test/v1',
    );
  });

  it('retries a configured token 401 with ADC and normalizes the GLM model name', async () => {
    const adcAccessTokenProvider: VertexAccessTokenProvider = {
      getAccessToken: vi.fn().mockResolvedValue('adc-access-token'),
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = new VertexProvider({
      explicitBaseUrl: 'https://vertex.example.test/v1',
      configuredAccessToken: 'configured-access-token',
      adcAccessTokenProvider,
      fetchImplementation,
    });

    const response = await provider.createChatCompletion({
      body: { model: 'glm-5-maas', messages: [] },
      feature: 'chat',
      requestId: 'request-one',
    });

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers).get('authorization'),
    ).toBe('Bearer configured-access-token');
    expect(
      new Headers(fetchImplementation.mock.calls[1]?.[1]?.headers).get('authorization'),
    ).toBe('Bearer adc-access-token');
    expect(fetchImplementation.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ model: 'zai-org/glm-5-maas', messages: [] }),
    );
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it('returns the configured-token 401 when ADC has no different fallback token', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    const provider = new VertexProvider({
      explicitBaseUrl: 'https://vertex.example.test/v1',
      configuredAccessToken: 'configured-access-token',
      adcAccessTokenProvider: { getAccessToken: async () => undefined },
      fetchImplementation,
    });

    expect(
      (
        await provider.createChatCompletion({
          body: { model: 'gemini-test' },
          feature: 'chat',
          requestId: 'request-one',
        })
      ).status,
    ).toBe(401);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});
