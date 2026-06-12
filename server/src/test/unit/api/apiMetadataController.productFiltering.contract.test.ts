import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiMetadataController } from '../../../lib/api/controllers/ApiMetadataController';
import { MetadataService } from '../../../lib/api/services/MetadataService';

describe('ApiMetadataController product filtering contract', () => {
  it('filters endpoints and openapi payloads for AlgaDesk while preserving allowed API surfaces', async () => {
    const controller = new ApiMetadataController();
    vi.spyOn(controller as any, 'authenticate').mockResolvedValue(
      Object.assign(new NextRequest('http://localhost:3000/api/v1/meta/endpoints', { headers: { 'x-api-key': 'k' } }), {
        context: { tenant: 'tenant-a', user: { user_id: 'u1' } },
      }),
    );
    vi.spyOn(controller as any, 'checkPermission').mockResolvedValue(undefined);
    vi.spyOn(controller as any, 'assertProductApiAccess').mockResolvedValue(undefined);
    vi.spyOn(controller as any, 'getApiMetadataProductCode').mockResolvedValue('algadesk');

    vi.spyOn((controller as any).metadataService, 'getApiEndpoints').mockResolvedValue({
      success: true,
      data: {
        endpoints: [
          { path: '/api/v1/tickets', method: 'GET', summary: 'tickets' },
          { path: '/api/v1/projects', method: 'GET', summary: 'projects' },
        ],
        totalEndpoints: 2,
        categories: ['Tickets', 'Projects'],
        version: 'v1',
        lastUpdated: new Date().toISOString(),
      },
      meta: { generated_at: new Date().toISOString(), api_version: 'v1' },
    });
    vi.spyOn((controller as any).metadataService, 'generateOpenApiSpec').mockResolvedValue({
      success: true,
      data: {
        openapi: '3.0.0',
        info: { title: 'API', version: 'v1' },
        servers: [{ url: 'http://localhost' }],
        paths: {
          '/api/v1/tickets': { get: { responses: { '200': { description: 'ok' } } } },
          '/api/v1/projects': { get: { responses: { '200': { description: 'ok' } } } },
        },
        components: { schemas: {} },
      },
      meta: { generated_at: new Date().toISOString(), generator: 'test' },
    });

    const endpointsRes = await controller.getEndpoints()(
      new NextRequest('http://localhost:3000/api/v1/meta/endpoints', { headers: { 'x-api-key': 'k' } }),
    );
    const endpointsBody = await endpointsRes.json();
    expect(endpointsRes.status).toBe(200);
    expect(endpointsBody.data.endpoints.map((entry: any) => entry.path)).toEqual(['/api/v1/tickets']);

    const openApiRes = await controller.getOpenApiSpec()(
      new NextRequest('http://localhost:3000/api/v1/meta/openapi', { headers: { 'x-api-key': 'k' } }),
    );
    const openApiBody = await openApiRes.json();
    expect(openApiRes.status).toBe(200);
    expect(Object.keys(openApiBody.paths)).toEqual(['/api/v1/tickets']);
  });
});

describe('MetadataService product OpenAPI metadata', () => {
  it('adds direct x-alga-products metadata to live OpenAPI operations', async () => {
    const service = new MetadataService({} as any, {} as any);
    vi.spyOn(service as any, 'discoverEndpoints').mockResolvedValue([
      {
        path: '/api/v1/tickets',
        method: 'GET',
        summary: 'tickets',
        description: 'tickets',
        tags: ['Tickets'],
        operationId: 'getTickets',
        requiresAuth: true,
        permissions: [],
      },
      {
        path: '/api/v1/projects',
        method: 'GET',
        summary: 'projects',
        description: 'projects',
        tags: ['Projects'],
        operationId: 'getProjects',
        requiresAuth: true,
        permissions: [],
      },
      {
        path: '/api/v1/tickets/{id}/time-entries',
        method: 'GET',
        summary: 'ticket time entries',
        description: 'ticket time entries',
        tags: ['Tickets'],
        operationId: 'getTicketTimeEntries',
        requiresAuth: true,
        permissions: [],
      },
    ]);
    vi.spyOn(service as any, 'discoverSchemas').mockResolvedValue([]);

    const spec = await service.generateOpenApiSpec(
      { format: 'json', includeExamples: false, includeSchemas: false },
      'tenant-a',
    );

    expect(spec.data.paths['/api/v1/tickets'].get['x-alga-products']).toEqual(['psa', 'algadesk']);
    expect(spec.data.paths['/api/v1/projects'].get['x-alga-products']).toEqual(['psa']);
    expect(spec.data.paths['/api/v1/tickets/{id}/time-entries'].get['x-alga-products']).toEqual(['psa']);
  });
});
