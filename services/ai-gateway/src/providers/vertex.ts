import { GoogleAuth } from 'google-auth-library';

import { chatCompletionsUrl, createProviderHeaders } from './http.js';
import type { UpstreamChatRequest, UpstreamProvider } from './types.js';

const VERTEX_AUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export interface VertexAccessTokenProvider {
  getAccessToken(): Promise<string | undefined>;
}

export class GoogleAdcAccessTokenProvider implements VertexAccessTokenProvider {
  private readonly auth = new GoogleAuth({ scopes: [VERTEX_AUTH_SCOPE] });

  async getAccessToken(): Promise<string | undefined> {
    const client = await this.auth.getClient();
    const response = await client.getAccessToken();
    const token = typeof response === 'string' ? response : response?.token;
    return token?.trim() || undefined;
  }
}

export interface VertexProviderOptions {
  explicitBaseUrl?: string;
  projectId?: string;
  location?: string;
  configuredAccessToken?: string;
  adcAccessTokenProvider?: VertexAccessTokenProvider;
  fetchImplementation?: typeof fetch;
}

export function resolveVertexBaseUrl(options: {
  explicitBaseUrl?: string;
  projectId?: string;
  location?: string;
}): string {
  if (options.explicitBaseUrl?.trim()) {
    return options.explicitBaseUrl.trim().replace(/\/+$/, '');
  }

  const projectId = options.projectId?.trim();
  const location = options.location?.trim();
  if (!projectId || !location) {
    throw new Error(
      'Vertex provider requires VERTEX_OPENAPI_BASE_URL or both VERTEX_PROJECT_ID and VERTEX_LOCATION',
    );
  }

  const host =
    location.toLowerCase() === 'global'
      ? 'aiplatform.googleapis.com'
      : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${projectId}/locations/${location}/endpoints/openapi`;
}

function normalizeVertexRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  return body.model === 'glm-5-maas'
    ? { ...body, model: 'zai-org/glm-5-maas' }
    : body;
}

export class VertexProvider implements UpstreamProvider {
  readonly id = 'vertex' as const;
  private readonly endpoint: string;
  private readonly configuredAccessToken: string | undefined;
  private readonly adcAccessTokenProvider: VertexAccessTokenProvider;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: VertexProviderOptions) {
    this.endpoint = chatCompletionsUrl(resolveVertexBaseUrl(options));
    this.configuredAccessToken = options.configuredAccessToken?.trim() || undefined;
    this.adcAccessTokenProvider =
      options.adcAccessTokenProvider ?? new GoogleAdcAccessTokenProvider();
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  private async fetchWithToken(request: UpstreamChatRequest, token: string): Promise<Response> {
    return this.fetchImplementation(this.endpoint, {
      method: 'POST',
      headers: createProviderHeaders(token, request.feature, request.requestId),
      body: JSON.stringify(normalizeVertexRequestBody(request.body)),
    });
  }

  async createChatCompletion(request: UpstreamChatRequest): Promise<Response> {
    const adcToken = async (): Promise<string> => {
      const token = await this.adcAccessTokenProvider.getAccessToken();
      if (!token) {
        throw new Error('Vertex provider requires Google ADC credentials');
      }
      return token;
    };

    if (!this.configuredAccessToken) {
      return this.fetchWithToken(request, await adcToken());
    }

    const configuredResponse = await this.fetchWithToken(request, this.configuredAccessToken);
    if (configuredResponse.status !== 401) {
      return configuredResponse;
    }

    const fallbackToken = await this.adcAccessTokenProvider.getAccessToken();
    if (!fallbackToken?.trim() || fallbackToken.trim() === this.configuredAccessToken) {
      return configuredResponse;
    }

    console.warn(
      '[ai-gateway] Vertex returned 401 for GOOGLE_CLOUD_ACCESS_TOKEN; retrying with ADC',
    );
    return this.fetchWithToken(request, fallbackToken.trim());
  }
}
