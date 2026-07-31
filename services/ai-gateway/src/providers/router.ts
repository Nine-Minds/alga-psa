import process from 'node:process';

import { OpenRouterProvider } from './openRouter.js';
import type { ProviderId, ProviderRouter, UpstreamProvider } from './types.js';
import { VertexProvider } from './vertex.js';

export interface ModelRoute {
  pattern: string;
  providerId: ProviderId;
  literalCharacters: number;
  wildcardCharacters: number;
}

function escapeRegularExpression(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function matchesPattern(pattern: string, model: string): boolean {
  let source = '^';
  for (const character of pattern) {
    if (character === '*') {
      source += '.*';
    } else if (character === '?') {
      source += '.';
    } else {
      source += escapeRegularExpression(character);
    }
  }
  return new RegExp(`${source}$`).test(model);
}

function parseProviderId(value: unknown, context: string): ProviderId {
  if (value !== 'openrouter' && value !== 'vertex') {
    throw new Error(`${context} must be openrouter or vertex`);
  }
  return value;
}

export function parseModelRoutes(value: string | undefined): ModelRoute[] {
  if (!value?.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('AI_GATEWAY_MODEL_ROUTES must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('AI_GATEWAY_MODEL_ROUTES must be a JSON object');
  }

  return Object.entries(parsed).map(([pattern, providerId]) => {
    if (!pattern) {
      throw new Error('AI_GATEWAY_MODEL_ROUTES patterns must not be empty');
    }
    let literalCharacters = 0;
    let wildcardCharacters = 0;
    for (const character of pattern) {
      if (character === '*' || character === '?') {
        wildcardCharacters += 1;
      } else {
        literalCharacters += 1;
      }
    }
    return {
      pattern,
      providerId: parseProviderId(providerId, `Route ${pattern}`),
      literalCharacters,
      wildcardCharacters,
    };
  });
}

export interface EnvironmentProviderRouterOptions {
  routes: ModelRoute[];
  defaultProviderId: ProviderId;
  providers: Record<ProviderId, UpstreamProvider>;
}

export class EnvironmentProviderRouter implements ProviderRouter {
  constructor(private readonly options: EnvironmentProviderRouterOptions) {}

  resolve(model: string): UpstreamProvider {
    const route = this.options.routes
      .filter((candidate) => matchesPattern(candidate.pattern, model))
      .sort((left, right) => {
        if (left.literalCharacters !== right.literalCharacters) {
          return right.literalCharacters - left.literalCharacters;
        }
        if (left.wildcardCharacters !== right.wildcardCharacters) {
          return left.wildcardCharacters - right.wildcardCharacters;
        }
        return left.pattern.localeCompare(right.pattern);
      })[0];
    return this.options.providers[route?.providerId ?? this.options.defaultProviderId];
  }
}

class LazyProvider implements UpstreamProvider {
  private provider: UpstreamProvider | undefined;

  constructor(
    readonly id: ProviderId,
    private readonly factory: () => UpstreamProvider,
  ) {}

  createChatCompletion(
    request: Parameters<UpstreamProvider['createChatCompletion']>[0],
  ): Promise<Response> {
    this.provider ??= this.factory();
    return this.provider.createChatCompletion(request);
  }
}

export function createProviderRouterFromEnvironment(): ProviderRouter {
  const defaultProviderId = parseProviderId(
    process.env.AI_GATEWAY_DEFAULT_PROVIDER?.trim().toLowerCase() || 'openrouter',
    'AI_GATEWAY_DEFAULT_PROVIDER',
  );
  return new EnvironmentProviderRouter({
    routes: parseModelRoutes(process.env.AI_GATEWAY_MODEL_ROUTES),
    defaultProviderId,
    providers: {
      openrouter: new OpenRouterProvider({
        apiKey: process.env.OPENROUTER_API_KEY?.trim() || '',
        baseUrl:
          process.env.OPENROUTER_BASE_URL?.trim() ||
          process.env.OPENROUTER_API?.trim() ||
          undefined,
      }),
      vertex: new LazyProvider(
        'vertex',
        () =>
          new VertexProvider({
            explicitBaseUrl: process.env.VERTEX_OPENAPI_BASE_URL,
            projectId: process.env.VERTEX_PROJECT_ID,
            location: process.env.VERTEX_LOCATION,
            configuredAccessToken: process.env.GOOGLE_CLOUD_ACCESS_TOKEN,
          }),
      ),
    },
  });
}
