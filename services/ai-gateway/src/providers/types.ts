export type ProviderId = 'openrouter' | 'vertex';

export interface UpstreamChatRequest {
  body: Record<string, unknown>;
  feature: string;
  requestId: string;
}

export interface UpstreamProvider {
  readonly id: ProviderId;
  createChatCompletion(request: UpstreamChatRequest): Promise<Response>;
}

export interface ProviderRouter {
  resolve(model: string): UpstreamProvider;
}
