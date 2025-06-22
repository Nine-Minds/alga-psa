/**
 * API Registry and Metadata System
 * Provides API discovery, documentation, and reflection capabilities
 */

import { ZodSchema } from 'zod';

export interface ApiEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  resource: string;
  action: string;
  description: string;
  permissions?: {
    resource: string;
    action: string;
  };
  requestSchema?: ZodSchema;
  responseSchema?: ZodSchema;
  querySchema?: ZodSchema;
  parameters?: {
    path?: Record<string, string>;
    query?: Record<string, string>;
    body?: Record<string, string>;
  };
  examples?: {
    request?: any;
    response?: any;
  };
  tags?: string[];
  deprecated?: boolean;
  version?: string;
}

export interface ApiResource {
  name: string;
  description: string;
  endpoints: ApiEndpoint[];
  relationships?: {
    parent?: string;
    children?: string[];
    related?: string[];
  };
  model?: {
    properties: Record<string, any>;
    required: string[];
  };
}

class ApiRegistryClass {
  private endpoints: Map<string, ApiEndpoint> = new Map();
  private resources: Map<string, ApiResource> = new Map();

  /**
   * Register an API endpoint
   */
  registerEndpoint(endpoint: ApiEndpoint): void {
    const key = `${endpoint.method}:${endpoint.path}`;
    this.endpoints.set(key, endpoint);

    // Update resource information
    this.updateResource(endpoint);
  }

  /**
   * Register multiple endpoints for a resource
   */
  registerResource(resource: ApiResource): void {
    this.resources.set(resource.name, resource);
    
    resource.endpoints.forEach(endpoint => {
      this.registerEndpoint(endpoint);
    });
  }

  /**
   * Get all registered endpoints
   */
  getEndpoints(): ApiEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * Get endpoints for a specific resource
   */
  getResourceEndpoints(resource: string): ApiEndpoint[] {
    return this.getEndpoints().filter(endpoint => endpoint.resource === resource);
  }

  /**
   * Get endpoint by method and path
   */
  getEndpoint(method: string, path: string): ApiEndpoint | undefined {
    return this.endpoints.get(`${method}:${path}`);
  }

  /**
   * Get all resources
   */
  getResources(): ApiResource[] {
    return Array.from(this.resources.values());
  }

  /**
   * Get specific resource
   */
  getResource(name: string): ApiResource | undefined {
    return this.resources.get(name);
  }

  /**
   * Generate OpenAPI specification
   */
  generateOpenApiSpec(): any {
    const spec = {
      openapi: '3.0.0',
      info: {
        title: 'Alga PSA API',
        version: '1.0.0',
        description: 'Professional Services Automation API'
      },
      servers: [
        {
          url: '/api/v1',
          description: 'API v1'
        }
      ],
      paths: {} as any,
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'x-api-key'
          }
        },
        schemas: {} as any
      },
      security: [
        {
          ApiKeyAuth: []
        }
      ]
    };

    // Generate paths from endpoints
    this.endpoints.forEach(endpoint => {
      if (!spec.paths[endpoint.path]) {
        spec.paths[endpoint.path] = {};
      }

      spec.paths[endpoint.path][endpoint.method.toLowerCase()] = {
        summary: endpoint.description,
        tags: endpoint.tags || [endpoint.resource],
        parameters: this.generateParameters(endpoint),
        requestBody: this.generateRequestBody(endpoint),
        responses: this.generateResponses(endpoint),
        security: [{ ApiKeyAuth: [] }]
      };
    });

    return spec;
  }

  /**
   * Generate API metadata for discovery
   */
  generateMetadata(): any {
    return {
      version: '1.0.0',
      resources: this.getResources().map(resource => ({
        name: resource.name,
        description: resource.description,
        endpoints: resource.endpoints.length,
        relationships: resource.relationships,
        actions: resource.endpoints.map(e => e.action)
      })),
      endpoints: this.getEndpoints().map(endpoint => ({
        path: endpoint.path,
        method: endpoint.method,
        resource: endpoint.resource,
        action: endpoint.action,
        description: endpoint.description,
        permissions: endpoint.permissions,
        deprecated: endpoint.deprecated || false
      })),
      totalEndpoints: this.endpoints.size,
      totalResources: this.resources.size
    };
  }

  /**
   * Generate HATEOAS links for a resource
   */
  generateHateoasLinks(resource: string, id?: string): any {
    const links: any = {};
    const resourceEndpoints = this.getResourceEndpoints(resource);

    resourceEndpoints.forEach(endpoint => {
      let href = endpoint.path;
      
      // Replace path parameters
      if (id && href.includes('{id}')) {
        href = href.replace('{id}', id);
      }

      const rel = this.getRelFromAction(endpoint.action);
      if (rel) {
        links[rel] = {
          href,
          method: endpoint.method,
          type: 'application/json'
        };
      }
    });

    return links;
  }

  private updateResource(endpoint: ApiEndpoint): void {
    const existing = this.resources.get(endpoint.resource);
    if (existing) {
      if (!existing.endpoints.some(e => e.path === endpoint.path && e.method === endpoint.method)) {
        existing.endpoints.push(endpoint);
      }
    } else {
      this.resources.set(endpoint.resource, {
        name: endpoint.resource,
        description: `${endpoint.resource} resource`,
        endpoints: [endpoint]
      });
    }
  }

  private generateParameters(endpoint: ApiEndpoint): any[] {
    const parameters: any[] = [];

    // Path parameters
    const pathParams = endpoint.path.match(/{([^}]+)}/g);
    if (pathParams) {
      pathParams.forEach(param => {
        const name = param.slice(1, -1);
        parameters.push({
          name,
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' }
        });
      });
    }

    // Query parameters from schema
    if (endpoint.querySchema) {
      // This would need more sophisticated handling to extract from Zod schema
    }

    return parameters;
  }

  private generateRequestBody(endpoint: ApiEndpoint): any {
    if (endpoint.requestSchema && ['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
      return {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object'
              // Would need to convert Zod schema to JSON schema
            }
          }
        }
      };
    }
    return undefined;
  }

  private generateResponses(endpoint: ApiEndpoint): any {
    const responses: any = {
      '400': {
        description: 'Bad Request',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                error: {
                  type: 'object',
                  properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                    details: { type: 'object' }
                  }
                }
              }
            }
          }
        }
      },
      '401': { description: 'Unauthorized' },
      '403': { description: 'Forbidden' },
      '500': { description: 'Internal Server Error' }
    };

    // Success responses
    switch (endpoint.method) {
      case 'GET':
        responses['200'] = {
          description: 'Success',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'object' }
                }
              }
            }
          }
        };
        break;
      case 'POST':
        responses['201'] = {
          description: 'Created',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'object' }
                }
              }
            }
          }
        };
        break;
      case 'PUT':
      case 'PATCH':
        responses['200'] = {
          description: 'Updated',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'object' }
                }
              }
            }
          }
        };
        break;
      case 'DELETE':
        responses['204'] = { description: 'No Content' };
        break;
    }

    return responses;
  }

  private getRelFromAction(action: string): string | null {
    const mapping: Record<string, string> = {
      'list': 'collection',
      'create': 'create',
      'read': 'self',
      'update': 'edit',
      'delete': 'delete'
    };
    return mapping[action] || null;
  }
}

// Singleton instance
export const ApiRegistry = new ApiRegistryClass();

// Decorator for registering endpoints
export function RegisterEndpoint(endpoint: Omit<ApiEndpoint, 'path' | 'method'>) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // This would be used to automatically register endpoints
    // Implementation would depend on how routes are structured
  };
}

// Helper functions for common endpoint patterns
export function createCrudEndpoints(resource: string, description: string): ApiEndpoint[] {
  return [
    {
      path: `/api/v1/${resource}`,
      method: 'GET',
      resource,
      action: 'list',
      description: `List ${description}`,
      permissions: { resource, action: 'read' }
    },
    {
      path: `/api/v1/${resource}`,
      method: 'POST',
      resource,
      action: 'create',
      description: `Create ${description}`,
      permissions: { resource, action: 'create' }
    },
    {
      path: `/api/v1/${resource}/{id}`,
      method: 'GET',
      resource,
      action: 'read',
      description: `Get ${description} by ID`,
      permissions: { resource, action: 'read' }
    },
    {
      path: `/api/v1/${resource}/{id}`,
      method: 'PUT',
      resource,
      action: 'update',
      description: `Update ${description}`,
      permissions: { resource, action: 'update' }
    },
    {
      path: `/api/v1/${resource}/{id}`,
      method: 'DELETE',
      resource,
      action: 'delete',
      description: `Delete ${description}`,
      permissions: { resource, action: 'delete' }
    }
  ];
}