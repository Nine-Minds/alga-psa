import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { ApiEndpoint, ApiPermissionInfo, ApiSchemaInfo } from '@/lib/api/schemas/metadataSchemas';
import { MetadataService } from '@/lib/api/services/MetadataService';

const noopDb: any = {};
const noopEventBus: any = {};

describe('MetadataService', () => {
  let service: MetadataService;

  beforeEach(() => {
    service = new MetadataService(noopDb, noopEventBus);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleEndpoints: ApiEndpoint[] = [
    {
      path: '/api/v1/teams',
      method: 'GET',
      summary: 'List teams',
      description: 'List all teams',
      tags: ['Users & Teams'],
      operationId: 'getTeams',
      requiresAuth: true,
      permissions: ['teams:read'],
    },
    {
      path: '/api/v1/meta/docs',
      method: 'GET',
      summary: 'Get docs',
      description: 'Serve Swagger UI',
      tags: ['API Metadata'],
      operationId: 'getDocs',
      requiresAuth: false,
      permissions: [],
    },
    {
      path: '/api/v1/teams',
      method: 'POST',
      summary: 'Create team',
      description: 'Create a team',
      tags: ['Users & Teams'],
      operationId: 'postTeams',
      requiresAuth: true,
      permissions: ['teams:create'],
    },
  ];

  const sampleSchemas: ApiSchemaInfo[] = [
    {
      name: 'Team',
      type: 'model',
      properties: {
        team_id: { type: 'string' },
        team_name: { type: 'string' },
      },
      required: ['team_name'],
    },
  ];

  const samplePermissions: ApiPermissionInfo[] = [
    {
      permission: 'teams:read',
      description: 'Read teams',
      category: 'Users & Teams',
      endpoints: ['/api/v1/teams'],
    },
  ];

  it('filters endpoints by method while preserving metadata', async () => {
    vi.spyOn(service as any, 'discoverEndpoints').mockResolvedValue(sampleEndpoints);

    const result = await service.getApiEndpoints({ method: 'GET' } as any, 'tenant-123');

    expect(result.data.endpoints).toHaveLength(2);
    expect(result.data.endpoints.every(endpoint => endpoint.method === 'GET')).toBe(true);
    expect(result.data.categories).toContain('Users & Teams');
    expect(result.data.categories).toContain('API Metadata');
  });

  it('throws when tenant context is missing', async () => {
    await expect(service.getApiEndpoints({} as any, '')).rejects.toThrow('Tenant ID is required');
    await expect(service.getApiSchemas({} as any, '')).rejects.toThrow('Tenant ID is required');
    await expect(service.getApiPermissions('')).rejects.toThrow('Tenant ID is required');
    await expect(service.generateOpenApiSpec({} as any, '')).rejects.toThrow('Tenant ID is required');
    await expect(service.getApiStats('', '24h')).rejects.toThrow('Tenant ID is required');
  });

  it('maps schemas and categories from discovered schema files', async () => {
    vi.spyOn(service as any, 'discoverSchemas').mockResolvedValue(sampleSchemas);

    const result = await service.getApiSchemas({} as any, 'tenant-123');

    expect(result.data.schemas).toHaveLength(1);
    expect(result.data.categories).toEqual(['Administration']);
    expect(result.data.schemas[0].name).toBe('Team');
  });

  it('builds OpenAPI spec with secured and unsecured paths', async () => {
    vi.spyOn(service as any, 'discoverEndpoints').mockResolvedValue(sampleEndpoints);
    vi.spyOn(service as any, 'discoverSchemas').mockResolvedValue(sampleSchemas);

    const result = await service.generateOpenApiSpec({} as any, 'tenant-123');

    expect(result.data.openapi).toBe('3.0.3');
    expect(result.data.paths['/api/v1/teams'].get.security).toEqual([{ ApiKeyAuth: [] }]);
    expect(result.data.paths['/api/v1/meta/docs'].get.security).toEqual([]);
    expect(result.data.components?.schemas?.Team).toBeDefined();
  });

  it('summarises endpoint statistics and coverage', async () => {
    vi.spyOn(service as any, 'discoverEndpoints').mockResolvedValue(sampleEndpoints);
    vi.spyOn(service as any, 'discoverSchemas').mockResolvedValue(sampleSchemas);
    vi.spyOn(service as any, 'discoverPermissions').mockResolvedValue(samplePermissions);

    const result = await service.getApiStats('tenant-123', '7d');

    expect(result.data.totalEndpoints).toBe(3);
    expect(result.data.endpointsByMethod.GET).toBe(2);
    expect(result.data.endpointsByCategory['Users & Teams']).toBe(2);
    expect(result.data.totalSchemas).toBe(1);
    expect(result.data.totalPermissions).toBe(1);
    expect(result.data.coverage.deprecated).toBe(0);
    expect(result.meta?.period).toBe('7d');
  });
});
