import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import YAML from 'yaml';
import { z } from 'zod';

// Reuse domain schemas where practical
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'x-api-key',
});

const ErrorResponse = registry.register('ErrorResponse', z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
}));

const ServiceCategory = registry.register(
  'ServiceCategory',
  z
    .object({
      tenant: z.string().uuid(),
      category_id: z.string().uuid(),
      category_name: z.string(),
      description: z.string().nullable().optional(),
      display_order: z.number().int().optional().default(0),
      is_active: z.boolean(),
      created_at: z.string().datetime(),
      updated_at: z.string().datetime(),
      created_by: z.string().uuid(),
      updated_by: z.string().uuid(),
      tags: z.array(z.string()).optional().describe('Future-proof: categories can be tagged for grouping.'),
    })
    .describe('Service category resource.')
);

const ServiceCategoryCreateRequest = registry.register(
  'ServiceCategoryCreateRequest',
  z.object({
    category_name: z
      .string()
      .min(1)
      .max(255)
      .describe('Display name for the service category.'),
    description: z
      .string()
      .max(1000)
      .optional()
      .describe('Optional description that provides more context for the category.'),
    is_active: z
      .boolean()
      .optional()
      .describe('Indicates whether the category is active (defaults to true).'),
  }).describe('Payload for creating a service category.')
);

const ServiceCategoryListQuery = registry.register(
  'ServiceCategoryListQuery',
  z.object({
    search: z.string().optional().describe('Filters categories whose name or description matches the provided value.'),
    is_active: z.boolean().optional().describe('Filters by whether the category is active.'),
    page: z.number().int().min(1).optional().describe('Page number (defaults to 1).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Number of records to return per page (defaults to 25, maximum 100).'),
  }).describe('Query parameters for listing service categories.')
);

const PaginatedServiceCategoryResponse = registry.register(
  'PaginatedServiceCategoryResponse',
  z.object({
    data: z.array(ServiceCategory),
    pagination: z.object({
      page: z.number().int(),
      limit: z.number().int(),
      total: z.number().int(),
      totalPages: z.number().int(),
      hasNext: z.boolean(),
      hasPrev: z.boolean(),
    }),
    meta: z.record(z.unknown()).optional(),
  }).describe('Paginated list response wrapper.')
);

registry.registerPath({
  method: 'get',
  path: '/api/v1/categories/service',
  summary: 'List service categories',
  description: 'Returns a paginated list of service categories within the current tenant.',
  tags: ['Service Categories'],
  security: [{ ApiKeyAuth: [] }],
  request: {
    query: ServiceCategoryListQuery,
  },
  responses: {
    200: {
      description: 'A paginated list of service categories.',
      content: {
        'application/json': {
          schema: PaginatedServiceCategoryResponse,
        },
      },
    },
    401: {
      description: 'Authentication failed.',
      content: {
        'application/json': { schema: ErrorResponse },
      },
    },
    403: {
      description: 'Authenticated user lacks the required permission.',
      content: {
        'application/json': { schema: ErrorResponse },
      },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/categories/service',
  summary: 'Create service category',
  description:
    'Creates a new service category for the tenant. Requires the billing settings create permission.',
  tags: ['Service Categories'],
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ServiceCategoryCreateRequest,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Service category created successfully.',
      content: {
        'application/json': {
          schema: z.object({ data: ServiceCategory }),
        },
      },
    },
    400: {
      description: 'Validation error.',
      content: {
        'application/json': { schema: ErrorResponse },
      },
    },
    401: {
      description: 'Authentication failed.',
      content: {
        'application/json': { schema: ErrorResponse },
      },
    },
    403: {
      description: 'Authenticated user lacks the required permission.',
      content: {
        'application/json': { schema: ErrorResponse },
      },
    },
  },
});

const generator = new OpenApiGeneratorV31(registry.definitions);

const document = generator.generateDocument({
  openapi: '3.1.0',
  info: {
    title: 'Alga PSA API',
    version: '0.1.0',
    description: 'OpenAPI specification generated from Zod schemas.',
  },
  servers: [
    { url: 'https://algapsa.com', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  tags: [{ name: 'Service Categories' }],
});

const outputDir = path.resolve(__dirname, '../docs/openapi');
fs.mkdirSync(outputDir, { recursive: true });

const jsonOutputPath = path.join(outputDir, 'alga-openapi.json');
const yamlOutputPath = path.join(outputDir, 'alga-openapi.yaml');

fs.writeFileSync(jsonOutputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
fs.writeFileSync(yamlOutputPath, `${YAML.stringify(document)}\n`, 'utf-8');

// eslint-disable-next-line no-console
console.log('OpenAPI specification written to:', jsonOutputPath, 'and', yamlOutputPath);

if (process.env.NODE_ENV === 'production') {
  fs.chmodSync(jsonOutputPath, 0o644);
  fs.chmodSync(yamlOutputPath, 0o644);
}
