import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ApiMetadataController } from '../../../lib/api/controllers/ApiMetadataController';

describe('ApiMetadataController product filtering contract', () => {
  it('filters endpoints and openapi payloads for Algadesk while preserving allowed API surfaces', async () => {
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
