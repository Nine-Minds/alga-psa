/**
 * API Metadata Schemas
 * Schemas for API discovery, documentation, and metadata endpoints
 */

import { z } from 'zod';

// Basic API endpoint metadata
export const apiEndpointSchema = z.object({
  path: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  summary: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  operationId: z.string().optional(),
  deprecated: z.boolean().optional(),
  requiresAuth: z.boolean().default(true),
  permissions: z.array(z.string()).optional(),
  parameters: z.array(z.object({
    name: z.string(),
    in: z.enum(['path', 'query', 'header', 'body']),
    required: z.boolean(),
    type: z.string(),
    description: z.string().optional(),
    example: z.any().optional()
  })).optional(),
  responses: z.record(z.object({
    description: z.string(),
    schema: z.any().optional()
  })).optional()
});

// API endpoint collection
export const apiEndpointsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    endpoints: z.array(apiEndpointSchema),
    totalEndpoints: z.number(),
    categories: z.array(z.string()),
    version: z.string(),
    lastUpdated: z.string()
  }),
  meta: z.object({
    generated_at: z.string(),
    api_version: z.string(),
    server_info: z.object({
      name: z.string(),
      version: z.string(),
      environment: z.string()
    }).optional()
  }).optional()
});

// Schema information
export const apiSchemaInfoSchema = z.object({
  name: z.string(),
  type: z.enum(['request', 'response', 'model']),
  description: z.string().optional(),
  properties: z.record(z.object({
    type: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    example: z.any().optional(),
    enum: z.array(z.string()).optional(),
    format: z.string().optional()
  })),
  required: z.array(z.string()).optional(),
  example: z.any().optional()
});

export const apiSchemasResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    schemas: z.array(apiSchemaInfoSchema),
    totalSchemas: z.number(),
    categories: z.array(z.string())
  }),
  meta: z.object({
    generated_at: z.string(),
    schema_version: z.string()
  }).optional()
});

// Permission information
export const apiPermissionInfoSchema = z.object({
  permission: z.string(),
  description: z.string(),
  category: z.string(),
  endpoints: z.array(z.string()),
  requiredRoles: z.array(z.string()).optional()
});

export const apiPermissionsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    permissions: z.array(apiPermissionInfoSchema),
    totalPermissions: z.number(),
    categories: z.array(z.string()),
    roles: z.array(z.object({
      name: z.string(),
      permissions: z.array(z.string())
    })).optional()
  })
});

// OpenAPI specification
export const openApiSpecSchema = z.object({
  openapi: z.string(),
  info: z.object({
    title: z.string(),
    version: z.string(),
    description: z.string().optional(),
    contact: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      url: z.string().optional()
    }).optional(),
    license: z.object({
      name: z.string(),
      url: z.string().optional()
    }).optional()
  }),
  servers: z.array(z.object({
    url: z.string(),
    description: z.string().optional()
  })),
  paths: z.record(z.any()),
  components: z.object({
    schemas: z.record(z.any()).optional(),
    securitySchemes: z.record(z.any()).optional(),
    parameters: z.record(z.any()).optional(),
    responses: z.record(z.any()).optional()
  }).optional(),
  security: z.array(z.record(z.array(z.string()))).optional(),
  tags: z.array(z.object({
    name: z.string(),
    description: z.string().optional()
  })).optional()
});

export const openApiResponseSchema = z.object({
  success: z.literal(true),
  data: openApiSpecSchema,
  meta: z.object({
    generated_at: z.string(),
    generator: z.string()
  }).optional()
});

// API health and status
export const apiHealthSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  version: z.string(),
  timestamp: z.string(),
  uptime: z.number(),
  services: z.record(z.object({
    status: z.enum(['up', 'down', 'degraded']),
    latency: z.number().optional(),
    message: z.string().optional()
  })),
  metrics: z.object({
    totalEndpoints: z.number(),
    totalRequests: z.number().optional(),
    averageResponseTime: z.number().optional(),
    errorRate: z.number().optional()
  }).optional()
});

export const apiHealthResponseSchema = z.object({
  success: z.literal(true),
  data: apiHealthSchema
});

// API statistics
export const apiStatsSchema = z.object({
  totalEndpoints: z.number(),
  endpointsByCategory: z.record(z.number()),
  endpointsByMethod: z.record(z.number()),
  totalSchemas: z.number(),
  totalPermissions: z.number(),
  coverage: z.object({
    documented: z.number(),
    tested: z.number(),
    deprecated: z.number()
  }),
  usage: z.object({
    totalRequests: z.number(),
    requestsByEndpoint: z.record(z.number()),
    averageResponseTime: z.number(),
    errorRate: z.number()
  }).optional()
});

export const apiStatsResponseSchema = z.object({
  success: z.literal(true),
  data: apiStatsSchema,
  meta: z.object({
    period: z.string(),
    generated_at: z.string()
  }).optional()
});

// Export types
export type ApiEndpoint = z.infer<typeof apiEndpointSchema>;
export type ApiEndpointsResponse = z.infer<typeof apiEndpointsResponseSchema>;
export type ApiSchemaInfo = z.infer<typeof apiSchemaInfoSchema>;
export type ApiSchemasResponse = z.infer<typeof apiSchemasResponseSchema>;
export type ApiPermissionInfo = z.infer<typeof apiPermissionInfoSchema>;
export type ApiPermissionsResponse = z.infer<typeof apiPermissionsResponseSchema>;
export type OpenApiSpec = z.infer<typeof openApiSpecSchema>;
export type OpenApiResponse = z.infer<typeof openApiResponseSchema>;
export type ApiHealth = z.infer<typeof apiHealthSchema>;
export type ApiHealthResponse = z.infer<typeof apiHealthResponseSchema>;
export type ApiStats = z.infer<typeof apiStatsSchema>;
export type ApiStatsResponse = z.infer<typeof apiStatsResponseSchema>;

// Query parameters for metadata endpoints
export const metadataQuerySchema = z.object({
  category: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
  deprecated: z.boolean().optional(),
  includeSchemas: z.boolean().default(false),
  includeExamples: z.boolean().default(false),
  format: z.enum(['json', 'yaml']).default('json')
});

export type MetadataQuery = z.infer<typeof metadataQuerySchema>;