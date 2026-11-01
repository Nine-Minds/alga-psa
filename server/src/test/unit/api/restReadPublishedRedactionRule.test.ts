import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * End to end through the REAL authorization kernel: a published `hide_sensitive_fields` bundle rule produces
 * `redactedFields` inside the kernel, and REST reads must serialize without those fields. Only the rule store (which
 * bundles are published for which principal) and the data services are stubbed. A second, unrestricted principal reads
 * the same records and must still see every field.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const PROJECT_ID = '22222222-2222-2222-2222-222222222221';
const TICKET_ID = '33333333-3333-3333-3333-333333333331';
const RESTRICTED_KEY = 'key-restricted';
const UNRESTRICTED_KEY = 'key-unrestricted';

const state = vi.hoisted(() => ({
  projects: [] as Record<string, any>[],
  tickets: [] as Record<string, any>[],
}));

vi.mock('server/src/lib/authorization/kernel', async () => {
  const {
    createAuthorizationKernel,
    BuiltinAuthorizationKernelProvider,
    BundleAuthorizationKernelProvider,
  } = await import('@alga-psa/authorization/kernel');
  // The published bundle, as resolveBundleNarrowingRulesForEvaluation returns it, assigned to the restricted key only.
  const publishedRules = [
    { id: 'rule-project', resource: 'project', action: 'read', templateKey: null, constraintKey: 'hide_sensitive_fields',
      redactedFields: ['description', 'budgeted_hours'] },
    { id: 'rule-ticket', resource: 'ticket', action: 'read', templateKey: null, constraintKey: 'hide_sensitive_fields',
      redactedFields: ['assigned_to'] },
  ];
  const kernel = createAuthorizationKernel({
    rbacEvaluator: async () => true,
    builtinProvider: new BuiltinAuthorizationKernelProvider({ relationshipRules: [] }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => (input.subject.apiKeyId === 'key-restricted' ? publishedRules : []),
    }),
  });
  return { getAuthorizationKernel: vi.fn(async () => kernel) };
});

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()),
  runWithApiKeyUser: vi.fn(async (_user: unknown, callback: () => Promise<any>) => callback()),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@/lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: vi.fn(async () => null),
  shouldBypassRateLimit: vi.fn(() => false),
}));
vi.mock('../../../lib/api/services/ProjectService', () => ({
  ProjectService: class {
    getById = vi.fn(async (id: string) => state.projects.find((p) => p.project_id === id) ?? null);
    list = vi.fn(async () => ({ data: state.projects, total: state.projects.length }));
  },
}));
vi.mock('../../../lib/api/services/TicketService', () => ({
  TicketService: class {
    getById = vi.fn(async (id: string) => state.tickets.find((t) => t.ticket_id === id) ?? null);
    list = vi.fn(async () => ({ data: state.tickets, total: state.tickets.length }));
  },
}));

import { ApiBaseController } from '../../../lib/api/controllers/ApiBaseController';
import { ApiProjectController } from '../../../lib/api/controllers/ApiProjectController';
import { ApiTicketController } from '../../../lib/api/controllers/ApiTicketController';

const user = { user_id: 'user-1', user_type: 'internal', tenant: TENANT };

function request(url: string, apiKeyId: string, params?: Record<string, string>) {
  const req = new NextRequest(`http://localhost${url}`, { headers: { 'x-api-key': apiKeyId } }) as any;
  if (params) req.params = Promise.resolve(params);
  return req;
}

beforeEach(() => {
  state.projects = [{
    project_id: PROJECT_ID, project_name: 'Migration', description: 'secret plan', budgeted_hours: 40,
    client_id: 'c-1', status: 's-1',
  }];
  state.tickets = [{
    ticket_id: TICKET_ID, title: 'Printer', client_id: 'c-1', assigned_to: 'u-9', assigned_to_name: 'Pat Doe',
  }];
  vi.spyOn(ApiBaseController.prototype as any, 'authenticate').mockImplementation(async (req: any) => {
    const apiKeyId = req.headers.get('x-api-key');
    req.context = { tenant: TENANT, user, userId: 'user-1', apiKeyId };
    return req;
  });
  vi.spyOn(ApiBaseController.prototype as any, 'checkPermission').mockResolvedValue(undefined);
});

async function getProject(apiKeyId: string) {
  const res = await new ApiProjectController().getById()(request(`/api/v1/projects/${PROJECT_ID}`, apiKeyId, { id: PROJECT_ID }));
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

async function getTicket(apiKeyId: string) {
  const res = await new ApiTicketController().getById()(request(`/api/v1/tickets/${TICKET_ID}`, apiKeyId, { id: TICKET_ID }));
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

describe('published hide_sensitive_fields rule through the real kernel', () => {
  it('GET /projects/{id}: the restricted key reads the project without the hidden fields', async () => {
    const data = await getProject(RESTRICTED_KEY);
    expect(data).toMatchObject({ project_id: PROJECT_ID, project_name: 'Migration', client_id: 'c-1', status: 's-1' });
    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('budgeted_hours');
  });

  it('GET /projects/{id}: an unrestricted key still reads every field', async () => {
    const data = await getProject(UNRESTRICTED_KEY);
    expect(data).toMatchObject({ project_id: PROJECT_ID, project_name: 'Migration', description: 'secret plan', budgeted_hours: 40 });
  });

  it('GET /projects (list): hidden fields are removed for the restricted key only', async () => {
    const restricted = await (await new ApiProjectController().list()(request('/api/v1/projects?page=1&limit=25', RESTRICTED_KEY))).json();
    expect(restricted.data).toHaveLength(1);
    expect(restricted.data[0]).not.toHaveProperty('description');
    expect(restricted.data[0].project_name).toBe('Migration');

    const open = await (await new ApiProjectController().list()(request('/api/v1/projects?page=1&limit=25', UNRESTRICTED_KEY))).json();
    expect(open.data[0].description).toBe('secret plan');
  });

  it('GET /tickets/{id}: same path, second resource type — hidden field and its derived name are withheld', async () => {
    const data = await getTicket(RESTRICTED_KEY);
    expect(data).toMatchObject({ ticket_id: TICKET_ID, title: 'Printer', client_id: 'c-1' });
    expect(data).not.toHaveProperty('assigned_to');
    expect(data.assigned_to_name).toBeNull();
  });

  it('GET /tickets/{id}: an unrestricted key still reads the assignee', async () => {
    const data = await getTicket(UNRESTRICTED_KEY);
    expect(data).toMatchObject({ ticket_id: TICKET_ID, assigned_to: 'u-9', assigned_to_name: 'Pat Doe' });
  });
});
