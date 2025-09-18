import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z, ZodTypeAny } from 'zod';
import {
  ApiRequestBodySpec,
  ApiRouteSpec,
  DocumentBuildOptions,
  RegistryMetadata,
} from './types';

type OpenApiBodyContent = Record<string, { schema: ZodTypeAny; description?: string }>;

type ResponseEntries = Record<string, {
  description: string;
  content?: Record<string, { schema: ZodTypeAny }>;
}>;

extendZodWithOpenApi(z);

export type RegistryEdition = 'ce' | 'ee';

export class ApiOpenApiRegistry {
  private readonly registry: OpenAPIRegistry;
  private readonly routes: ApiRouteSpec[] = [];
  private readonly edition: RegistryEdition;

  constructor(edition: RegistryEdition = 'ce') {
    this.registry = new OpenAPIRegistry();
    this.edition = edition;
  }

  registerSchema<TSchema extends ZodTypeAny>(name: string, schema: TSchema): TSchema {
    return this.registry.register(name, schema);
  }

  registerComponent<TComponent = unknown>(
    type: 'schemas' | 'responses' | 'parameters' | 'requestBodies' | 'headers' | 'securitySchemes',
    name: string,
    component: TComponent,
  ): TComponent {
    this.registry.registerComponent(type, name, component as any);
    return component;
  }

  registerRoute(route: ApiRouteSpec): void {
    if (!this.shouldIncludeRoute(route)) {
      return;
    }

    this.routes.push(route);
    const request = this.buildRequest(route);
    const responses = this.buildResponses(route.responses);
    const extensions = this.buildExtensions(route);

    const pathConfig = {
      method: route.method,
      path: route.path,
      summary: route.summary,
      description: route.description,
      operationId: route.operationId,
      deprecated: route.deprecated,
      tags: route.tags,
      security: route.security,
      request,
      responses,
      extensions,
    };

    this.registry.registerPath(pathConfig as any);
  }

  buildDocument(options: DocumentBuildOptions) {
    const generator = new OpenApiGeneratorV31(this.registry.definitions);

    const tags = options.tags ?? this.collectTags();

    return generator.generateDocument({
      openapi: '3.1.0',
      info: {
        title: options.title,
        version: options.version,
        description: options.description,
      },
      servers: options.servers,
      tags,
    });
  }

  getRegisteredRoutes(): ApiRouteSpec[] {
    return [...this.routes];
  }

  private collectTags(): Array<{ name: string }> {
    const tagSet = new Set<string>();
    for (const route of this.routes) {
      if (!route.tags) continue;
      for (const tag of route.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort().map((name) => ({ name }));
  }

  private buildRequest(route: ApiRouteSpec) {
    if (!route.request) {
      return undefined;
    }

    const { params, query, headers, body } = route.request;

    const request: Record<string, unknown> = {};

    if (params) {
      request.params = params;
    }
    if (query) {
      request.query = query;
    }
    if (headers) {
      request.headers = headers;
    }
    if (body) {
      const bodies = Array.isArray(body) ? body : [body];
      const content: OpenApiBodyContent = {};
      let required = false;
      let description: string | undefined;
      for (const bodySpec of bodies) {
        const contentType = bodySpec.contentType ?? 'application/json';
        content[contentType] = {
          schema: bodySpec.schema,
          description: bodySpec.description,
        };
        if (bodySpec.required ?? true) {
          required = true;
        }
        if (!description && bodySpec.description) {
          description = bodySpec.description;
        }
      }
      request.body = {
        description,
        required,
        content,
      };
    }

    return request;
  }

  private buildResponses(responses: ApiRouteSpec['responses']): ResponseEntries {
    const entries: ResponseEntries = {};
    for (const [status, response] of Object.entries(responses)) {
      const normalizedStatus = String(status);
      const contentType = response.contentType ?? 'application/json';
      const entry: ResponseEntries[string] = {
        description: response.description,
      };

      if (!response.emptyBody && response.schema) {
        entry.content = {
          [contentType]: {
            schema: response.schema,
          },
        };
      }

      entries[normalizedStatus] = entry;
    }
    return entries;
  }

  private buildExtensions(route: ApiRouteSpec) {
    const extensions: Record<string, unknown> = {
      ...(route.extensions ?? {}),
    };
    if (route.edition && route.edition !== 'both' && !('x-edition' in extensions)) {
      extensions['x-edition'] = route.edition.toUpperCase();
    }
    return Object.keys(extensions).length ? extensions : undefined;
  }

  private shouldIncludeRoute(route: ApiRouteSpec): boolean {
    if (!route.edition || route.edition === 'both') {
      return true;
    }
    return route.edition === this.edition;
  }
}

export const zOpenApi = z;

export interface ControllerRouteRegistrar {
  (registry: ApiOpenApiRegistry): void;
}

export interface RegistryInitOptions {
  edition?: RegistryEdition;
}

export function createRegistry(
  registrars: ControllerRouteRegistrar[] = [],
  options: RegistryInitOptions = {},
) {
  const registry = new ApiOpenApiRegistry(options.edition ?? 'ce');
  for (const registrar of registrars) {
    registrar(registry);
  }
  return registry;
}

export function buildDocument(
  registry: ApiOpenApiRegistry,
  metadata: DocumentBuildOptions,
) {
  return registry.buildDocument(metadata);
}
