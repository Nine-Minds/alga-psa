import { chatCompletionsUrl, createProviderHeaders } from './http.js';
import type { UpstreamChatRequest, UpstreamProvider } from './types.js';

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
}

export class OpenRouterProvider implements UpstreamProvider {
  readonly id = 'openrouter' as const;
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey.trim();
    this.endpoint = chatCompletionsUrl(options.baseUrl?.trim() || DEFAULT_OPENROUTER_BASE_URL);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async createChatCompletion(request: UpstreamChatRequest): Promise<Response> {
    if (!this.apiKey) {
      throw new Error('OpenRouter API key is not configured');
    }

    return this.fetchImplementation(this.endpoint, {
      method: 'POST',
      headers: createProviderHeaders(this.apiKey, request.feature, request.requestId),
      body: JSON.stringify(request.body),
    });
  }
}
