import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// T005 / T006 / F008 / F010 / F011: the three project materials handlers authenticate, check
// project:read / project:update, gate the project (record-level), validate the body, and delegate.

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROJECT = '22222222-2222-2222-2222-222222222222';
const MATERIAL = '55555555-5555-5555-5555-555555555555';
const SERVICE = '66666666-6666-6666-6666-666666666666';

const state = vi.hoisted(() => ({
  permitted: new Set<string>(),
  projectAllowed: true,
  projectExists: true,
  materialsClosed: false,
  checked: [] as string[],
}));

vi.mock('@alga-psa/authorization/subject', async (original) => ({
  ...await original<typeof import('@alga-psa/authorization/subject')>(),
  resolveAuthorizationSubject: (await import('../../../../test-utils/authorizationSubjectFixture')).resolveFixtureAuthorizationSubject,
}));
vi.mock('@alga-psa/authorization/recordCreateAuthorization', async (original) => ({
  ...await original<typeof import('@alga-psa/authorization/recordCreateAuthorization')>(),
  assertResourceOperationOpen: vi.fn(async () => {
    if (state.materialsClosed) throw new Error('Permission denied: Cannot project materials on projects');
  }),
}));
vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyForTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
    validateApiKeyAnyTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
  },
}));
vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ user_id: 'user-1', user_type: 'internal', tenant: TENANT })),
}));
vi.mock('@/lib/db', () => ({ runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()) }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) => {
    state.checked.push(`${resource}:${action}`);
    return state.permitted.has(`${resource}:${action}`);
  }),
}));
vi.mock('@alga-psa/db', async (original) => ({
  ...(await original<typeof import('@alga-psa/db')>()),
  tenantDb: vi.fn(() => ({
    tenantJoin: vi.fn(),
    table: () => ({ where: () => ({ first: async () => ({ project_id: PROJECT }) }) }),
  })),
}));
vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({
    authorizeResource: vi.fn(async () => ({ allowed: state.projectAllowed, redactedFields: [] })),
  })),
}));
vi.mock('@/lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: vi.fn(async () => undefined) }));
vi.mock('@/lib/api/services/ProjectService', () => ({ ProjectService: class {} }));

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const material = {
  project_material_id: MATERIAL, project_id: PROJECT, client_id: 'client-1', service_id: SERVICE,
  service_name: 'SSD Drive', sku: 'SSD-1TB', quantity: 2, rate: 7500, currency_code: 'EUR', is_billed: false,
  billing_destination: 'next_project_invoice',
};

const service = {
  getById: vi.fn(),
  getProjectMaterials: vi.fn(),
  addProjectMaterial: vi.fn(),
  deleteProjectMaterial: vi.fn(),
};

function makeController() {
  const controller = new ApiProjectController() as any;
  controller.assertProductApiAccess = async () => undefined;
  controller.projectService = service;
  return controller;
}

const get = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { 'x-api-key': 'key' } });
const send = (method: string, path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, {
  method,
  headers: { 'x-api-key': 'key', 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const validBody = { service_id: SERVICE, quantity: 2, rate: 7500, currency_code: 'eur' };
const collection = `/api/v1/projects/${PROJECT}/materials`;
const item = `${collection}/${MATERIAL}`;

beforeEach(() => {
  state.permitted = new Set(['project:read', 'project:update']);
  state.projectAllowed = true;
  state.materialsClosed = false;
  state.checked = [];
  vi.clearAllMocks();
  service.getById.mockImplementation(async () => (state.projectExists ? { project_id: PROJECT, project_name: 'Migration' } : null));
  service.getProjectMaterials.mockResolvedValue([material]);
  service.addProjectMaterial.mockResolvedValue(material);
  service.deleteProjectMaterial.mockResolvedValue(undefined);
  state.projectExists = true;
});

describe('project materials controller', () => {
  it('GET lists materials under project:read with 200', async () => {
    const res = await makeController().getMaterials()(get(collection));
    expect(res.status).toBe(200);
    expect((await res.json()).data[0]).toMatchObject({ project_material_id: MATERIAL, service_name: 'SSD Drive', sku: 'SSD-1TB' });
    expect(service.getProjectMaterials).toHaveBeenCalledWith(PROJECT, expect.objectContaining({ tenant: TENANT }));
    expect(state.checked).toContain('project:read');
  });

  it('POST validates the body, normalises currency, and returns 201 with the created material', async () => {
    const res = await makeController().addMaterial()(send('POST', collection, { ...validBody, description: 'Replacement' }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.project_material_id).toBe(MATERIAL);
    expect(service.addProjectMaterial).toHaveBeenCalledWith(
      PROJECT,
      { service_id: SERVICE, quantity: 2, rate: 7500, currency_code: 'EUR', description: 'Replacement' },
      expect.objectContaining({ tenant: TENANT }),
    );
    expect(state.checked).toContain('project:update');
  });

  it('DELETE returns 204 under project:update and passes both ids to the service', async () => {
    const res = await makeController().deleteMaterial()(send('DELETE', item));
    expect(res.status).toBe(204);
    expect(service.deleteProjectMaterial).toHaveBeenCalledWith(PROJECT, MATERIAL, expect.objectContaining({ tenant: TENANT }));
    expect(state.checked).toContain('project:update');
  });

  describe('T005 errors', () => {
    it.each([
      ['client_id (taken from the project)', { ...validBody, client_id: SERVICE }, 'client_id'],
      ['allow_reserved_override (interactive only)', { ...validBody, allow_reserved_override: true }, 'allow_reserved_override'],
      ['a missing currency_code', { service_id: SERVICE, quantity: 1, rate: 1 }, 'currency_code'],
      ['a non-positive quantity', { ...validBody, quantity: 0 }, 'quantity'],
      ['a negative rate', { ...validBody, rate: -1 }, 'rate'],
      ['an unknown billing_destination', { ...validBody, billing_destination: 'free' }, 'billing_destination'],
      ['a non-UUID billing_schedule_entry_id', { ...validBody, billing_schedule_entry_id: 'nope' }, 'billing_schedule_entry_id'],
    ])('POST rejects %s with 400 and the field path, writing nothing', async (_label, body, field) => {
      const res = await makeController().addMaterial()(send('POST', collection, body));
      expect(res.status).toBe(400);
      expect(JSON.stringify((await res.json()).error.details)).toContain(field);
      expect(service.addProjectMaterial).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown project on every route, before touching materials', async () => {
      state.projectExists = false;
      const c = makeController();
      expect((await c.getMaterials()(get(collection))).status).toBe(404);
      expect((await c.addMaterial()(send('POST', collection, validBody))).status).toBe(404);
      expect((await c.deleteMaterial()(send('DELETE', item))).status).toBe(404);
      expect(service.getProjectMaterials).not.toHaveBeenCalled();
      expect(service.addProjectMaterial).not.toHaveBeenCalled();
      expect(service.deleteProjectMaterial).not.toHaveBeenCalled();
    });

    it('returns 400 for malformed ids', async () => {
      const c = makeController();
      expect((await c.getMaterials()(get('/api/v1/projects/not-a-uuid/materials'))).status).toBe(400);
      expect((await c.deleteMaterial()(send('DELETE', `${collection}/not-a-uuid`))).status).toBe(400);
    });
  });

  describe('T006 permissions', () => {
    it('GET without project:read is 403; POST and DELETE without project:update are 403', async () => {
      const c = makeController();
      state.permitted = new Set(['project:update']);
      expect((await c.getMaterials()(get(collection))).status).toBe(403);
      state.permitted = new Set(['project:read']);
      expect((await c.addMaterial()(send('POST', collection, validBody))).status).toBe(403);
      expect((await c.deleteMaterial()(send('DELETE', item))).status).toBe(403);
      expect(service.getProjectMaterials).not.toHaveBeenCalled();
      expect(service.addProjectMaterial).not.toHaveBeenCalled();
      expect(service.deleteProjectMaterial).not.toHaveBeenCalled();
    });

    it('a project the caller cannot see is 404 on all three routes (record-level authorization)', async () => {
      state.projectAllowed = false;
      const c = makeController();
      expect((await c.getMaterials()(get(collection))).status).toBe(404);
      expect((await c.addMaterial()(send('POST', collection, validBody))).status).toBe(404);
      expect((await c.deleteMaterial()(send('DELETE', item))).status).toBe(404);
      expect(service.getProjectMaterials).not.toHaveBeenCalled();
      expect(service.addProjectMaterial).not.toHaveBeenCalled();
      expect(service.deleteProjectMaterial).not.toHaveBeenCalled();
    });

    it('GET is 403 when the project_materials operation is closed to the caller (seat technician), as in the UI', async () => {
      state.materialsClosed = true;
      const res = await makeController().getMaterials()(get(collection));
      expect(res.status).toBe(403);
      expect(service.getProjectMaterials).not.toHaveBeenCalled();
    });
  });
});
