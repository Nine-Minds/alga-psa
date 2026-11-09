/* @vitest-environment node */

/**
 * ApiRecurringTicketController with the recurring-ticket actions mocked: path parsing, the
 * client_id -> definition_client_id lookup, the messageKey -> HTTP status table, body forwarding,
 * list paging and the /upcoming draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  listRecurringTicketDefinitions: vi.fn(),
  getRecurringTicketDefinition: vi.fn(),
  createRecurringTicketDefinition: vi.fn(),
  updateRecurringTicketDefinition: vi.fn(),
  setRecurringTicketDefinitionActive: vi.fn(),
  archiveRecurringTicketDefinition: vi.fn(),
  addClientsToRecurringTicketDefinition: vi.fn(),
  updateRecurringTicketClient: vi.fn(),
  setRecurringTicketClientActive: vi.fn(),
  removeClientFromRecurringTicketDefinition: vi.fn(),
  listRecurringTicketOccurrences: vi.fn(),
  previewRecurringTicketOccurrences: vi.fn(),
}));

vi.mock('@alga-psa/tickets/actions/recurringTicketActions', () => actions);
vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
  ProductAccessError: class extends Error {},
}));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: () => 'allowed' }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));

const { ApiRecurringTicketController } = await import('@/lib/api/controllers/ApiRecurringTicketController');

const K = 'features/tickets:recurring.errors.';
const DEF = '11111111-1111-4111-8111-111111111111';
const OTHER_DEF = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const OTHER_CLIENT = '44444444-4444-4444-8444-444444444444';
const DEF_CLIENT = '55555555-5555-4555-8555-555555555555';
const TEMPLATE = '66666666-6666-4666-8666-666666666666';
const BASE = '/api/v1/tickets/recurring';

const definition = (over: Record<string, unknown> = {}) => ({
  definition_id: DEF,
  name: 'APNs',
  is_active: true,
  archived_at: null,
  ticket_template_id: TEMPLATE,
  recurrence: { frequency: 'yearly', month: 3, day: 1, end: { type: 'never' } },
  start_date: '2027-03-01',
  create_time: '08:00',
  due_time: '17:00',
  lead_days: 30,
  non_business_day_policy: 'previous',
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  definition: definition(over),
  clients: [{ definition_client_id: DEF_CLIENT, definition_id: DEF, client_id: CLIENT, client_name: 'Joymode', is_active: true }],
  next_due_at: null,
  time_zone: 'America/Chicago',
  effective_fields: {},
});

const req = (url: string, method = 'GET', body?: unknown) => {
  const r: any = new Request(`http://x${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  r.context = { tenant: 't1', user: { user_id: 'u1', user_type: 'internal' } };
  return r;
};

function makeController(opts: { allowed?: boolean } = {}) {
  const controller = new ApiRecurringTicketController() as any;
  controller.authenticate = vi.fn(async (r: any) => r);
  controller.runWithApiKeyContext = vi.fn(async (_r: any, fn: () => Promise<unknown>) => fn());
  controller.checkPermission = vi.fn(async (_r: any, action: string) => {
    if (opts.allowed === false) {
      const { ForbiddenError } = await import('@/lib/api/middleware/apiMiddleware');
      throw new ForbiddenError(`Permission denied: Cannot ${action} recurring_ticket`);
    }
  });
  return controller as InstanceType<typeof ApiRecurringTicketController> & { checkPermission: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  Object.values(actions).forEach((fn) => fn.mockReset());
  actions.getRecurringTicketDefinition.mockResolvedValue(detail());
});

describe('permission gate', () => {
  it('fails fast with 403 before any action runs, per the right grant', async () => {
    const c = makeController({ allowed: false });
    expect((await c.list()(req(BASE))).status).toBe(403);
    expect((await c.create()(req(BASE, 'POST', {}))).status).toBe(403);
    expect((await c.delete()(req(`${BASE}/${DEF}`, 'DELETE'))).status).toBe(403);
    expect((await c.pause()(req(`${BASE}/${DEF}/pause`, 'POST'))).status).toBe(403);
    expect(Object.values(actions).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it.each([
    ['list', 'read'], ['getById', 'read'], ['preview', 'read'], ['upcoming', 'read'], ['occurrences', 'read'],
    ['create', 'create'], ['update', 'update'], ['pause', 'update'], ['resume', 'update'], ['addClients', 'update'],
    ['updateClient', 'update'], ['pauseClient', 'update'], ['resumeClient', 'update'], ['removeClient', 'update'],
    ['delete', 'delete'],
  ] as const)('%s checks recurring_ticket:%s', async (method, action) => {
    const c = makeController();
    await (c as any)[method]()(req(`${BASE}/${DEF}/clients/${CLIENT}`, 'POST', {}));
    expect(c.checkPermission).toHaveBeenCalledWith(expect.anything(), action);
  });
});

describe('client_id -> definition_client_id lookup', () => {
  it('resolves the path client through the definition and passes definition_client_id to the action', async () => {
    actions.setRecurringTicketClientActive.mockResolvedValue({ definition_client_id: DEF_CLIENT, is_active: false });
    const c = makeController();
    const res = await c.pauseClient()(req(`${BASE}/${DEF}/clients/${CLIENT}/pause`, 'POST'));
    expect(res.status).toBe(200);
    expect(actions.getRecurringTicketDefinition).toHaveBeenCalledWith(DEF);
    expect(actions.setRecurringTicketClientActive).toHaveBeenCalledWith(DEF_CLIENT, false);
  });

  it('resume, update and remove use the same lookup', async () => {
    actions.setRecurringTicketClientActive.mockResolvedValue({});
    actions.updateRecurringTicketClient.mockResolvedValue({});
    actions.removeClientFromRecurringTicketDefinition.mockResolvedValue({});
    const c = makeController();
    await c.resumeClient()(req(`${BASE}/${DEF}/clients/${CLIENT}/resume`, 'POST'));
    expect(actions.setRecurringTicketClientActive).toHaveBeenCalledWith(DEF_CLIENT, true);

    const body = { overrides: {}, contact_id: null, location_id: null, asset_ids: [] };
    await c.updateClient()(req(`${BASE}/${DEF}/clients/${CLIENT}`, 'PUT', body));
    expect(actions.updateRecurringTicketClient).toHaveBeenCalledWith(DEF_CLIENT, body);

    const removed = await c.removeClient()(req(`${BASE}/${DEF}/clients/${CLIENT}`, 'DELETE'));
    expect(removed.status).toBe(204);
    expect(actions.removeClientFromRecurringTicketDefinition).toHaveBeenCalledWith(DEF_CLIENT);
  });

  it('is a 404 for a client that is on a different definition, and never calls the write action', async () => {
    // The definition in the path has no such client: the client belongs to OTHER_DEF.
    const c = makeController();
    for (const [method, url, verb] of [
      ['pauseClient', `${BASE}/${DEF}/clients/${OTHER_CLIENT}/pause`, 'POST'],
      ['resumeClient', `${BASE}/${DEF}/clients/${OTHER_CLIENT}/resume`, 'POST'],
      ['removeClient', `${BASE}/${DEF}/clients/${OTHER_CLIENT}`, 'DELETE'],
    ] as const) {
      expect((await (c as any)[method]()(req(url, verb))).status).toBe(404);
    }
    const body = { overrides: {}, contact_id: null, location_id: null, asset_ids: [] };
    expect((await c.updateClient()(req(`${BASE}/${DEF}/clients/${OTHER_CLIENT}`, 'PUT', body))).status).toBe(404);
    expect(actions.setRecurringTicketClientActive).not.toHaveBeenCalled();
    expect(actions.removeClientFromRecurringTicketDefinition).not.toHaveBeenCalled();
    expect(actions.updateRecurringTicketClient).not.toHaveBeenCalled();
    void OTHER_DEF;
  });

  it('is a 404 when the definition itself is unknown, and 400 for a malformed id', async () => {
    actions.getRecurringTicketDefinition.mockResolvedValue({ actionError: 'Recurring ticket not found', messageKey: `${K}definitionNotFound` });
    const c = makeController();
    expect((await c.pauseClient()(req(`${BASE}/${DEF}/clients/${CLIENT}/pause`, 'POST'))).status).toBe(404);
    expect((await c.getById()(req(`${BASE}/not-a-uuid`))).status).toBe(400);
    expect((await c.pauseClient()(req(`${BASE}/${DEF}/clients/nope/pause`, 'POST'))).status).toBe(400);
  });
});

describe('error mapping by messageKey', () => {
  const fail = (key: string) => ({ actionError: 'boom', messageKey: `${K}${key}` });

  it.each([
    ['definitionNotFound', 404],
    ['clientNotFound', 404],
    ['definitionArchived', 409],
    ['invalidReferences', 400],
  ])('%s -> %i', async (key, status) => {
    actions.setRecurringTicketDefinitionActive.mockResolvedValue(fail(key));
    const c = makeController();
    expect((await c.pause()(req(`${BASE}/${DEF}/pause`, 'POST'))).status).toBe(status);
  });

  it('clientNotFound from add-clients is a 400 (the body named a bad client)', async () => {
    actions.addClientsToRecurringTicketDefinition.mockResolvedValue(fail('clientNotFound'));
    const c = makeController();
    const res = await c.addClients()(req(`${BASE}/${DEF}/clients`, 'POST', { client_ids: [CLIENT] }));
    expect(res.status).toBe(400);
  });

  it('definitionArchived on add-clients stays 409; a permissionError is 403', async () => {
    const c = makeController();
    actions.addClientsToRecurringTicketDefinition.mockResolvedValue(fail('definitionArchived'));
    expect((await c.addClients()(req(`${BASE}/${DEF}/clients`, 'POST', { client_ids: [CLIENT] }))).status).toBe(409);
    actions.archiveRecurringTicketDefinition.mockResolvedValue({ permissionError: 'Permission denied' });
    expect((await c.delete()(req(`${BASE}/${DEF}`, 'DELETE'))).status).toBe(403);
  });

  it('a ZodError from the body is a 400, including an unknown key', async () => {
    const c = makeController();
    const res = await c.create()(req(BASE, 'POST', { name: 'x', title: 'not allowed' }));
    expect(res.status).toBe(400);
    expect(actions.createRecurringTicketDefinition).not.toHaveBeenCalled();
    expect((await c.addClients()(req(`${BASE}/${DEF}/clients`, 'POST', { client_ids: [] }))).status).toBe(400);
  });
});

describe('writes', () => {
  const body = {
    name: 'APNs', ticket_template_id: TEMPLATE, start_date: '2027-03-01', lead_days: 30,
    recurrence: { frequency: 'yearly', month: 3, day: 1, end: { type: 'never' } },
  };

  it('create returns 201 with the re-read detail', async () => {
    actions.createRecurringTicketDefinition.mockResolvedValue({ definition_id: DEF });
    const res = await makeController().create()(req(BASE, 'POST', body));
    expect(res.status).toBe(201);
    expect(actions.getRecurringTicketDefinition).toHaveBeenCalledWith(DEF);
    expect((await res.json()).data.definition.definition_id).toBe(DEF);
  });

  it('PUT forwards the parsed full body (defaults applied) and the path id', async () => {
    actions.updateRecurringTicketDefinition.mockResolvedValue({ definition_id: DEF });
    const res = await makeController().update()(req(`${BASE}/${DEF}`, 'PUT', body));
    expect(res.status).toBe(200);
    const [id, forwarded] = actions.updateRecurringTicketDefinition.mock.calls[0];
    expect(id).toBe(DEF);
    expect(forwarded).toMatchObject(body);
    expect(forwarded.create_time).toBe('08:00'); // omitted fields fall back to defaults: PUT is a full replace
  });

  it('add-clients reports added next to the refreshed detail', async () => {
    actions.addClientsToRecurringTicketDefinition.mockResolvedValue({ added: 1 });
    const res = await makeController().addClients()(req(`${BASE}/${DEF}/clients`, 'POST', { client_ids: [CLIENT] }));
    const json = await res.json();
    expect(actions.addClientsToRecurringTicketDefinition).toHaveBeenCalledWith(DEF, [CLIENT]);
    expect(json.data.added).toBe(1);
    expect(json.data.clients).toHaveLength(1);
  });

  it('DELETE archives and returns 204', async () => {
    actions.archiveRecurringTicketDefinition.mockResolvedValue({ definition_id: DEF });
    const res = await makeController().delete()(req(`${BASE}/${DEF}`, 'DELETE'));
    expect(res.status).toBe(204);
    expect(actions.archiveRecurringTicketDefinition).toHaveBeenCalledWith(DEF);
  });

  it('pause / resume call setRecurringTicketDefinitionActive with false / true', async () => {
    actions.setRecurringTicketDefinitionActive.mockResolvedValue({});
    const c = makeController();
    await c.pause()(req(`${BASE}/${DEF}/pause`, 'POST'));
    await c.resume()(req(`${BASE}/${DEF}/resume`, 'POST'));
    expect(actions.setRecurringTicketDefinitionActive.mock.calls).toEqual([[DEF, false], [DEF, true]]);
  });
});

describe('reads', () => {
  it('list pages and filters in memory and passes the status to the action', async () => {
    actions.listRecurringTicketDefinitions.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ definition_id: `d${i}`, name: i % 2 ? `Renewal ${i}` : `Backup ${i}` })),
    );
    const c = makeController();
    const res = await c.list()(req(`${BASE}?status=paused&page=2&limit=10`));
    expect(actions.listRecurringTicketDefinitions).toHaveBeenCalledWith('paused');
    const json = await res.json();
    expect(json.data).toHaveLength(10);
    expect(json.meta.pagination ?? json.pagination).toMatchObject({ page: 2, limit: 10, total: 30 });

    const searched = await (await c.list()(req(`${BASE}?search=renewal`))).json();
    expect(searched.data).toHaveLength(15);
    expect(actions.listRecurringTicketDefinitions).toHaveBeenLastCalledWith('all');
  });

  it('occurrences maps limit to pageSize, client_id to clientId, and takes total from the action', async () => {
    actions.listRecurringTicketOccurrences.mockResolvedValue({ items: [{ occurrence_id: 'o1' }], total: 41, page: 3, pageSize: 5 });
    const res = await makeController().occurrences()(req(`${BASE}/${DEF}/occurrences?status=created&client_id=${CLIENT}&page=3&limit=5`));
    expect(actions.listRecurringTicketOccurrences).toHaveBeenCalledWith(DEF, { status: 'created', clientId: CLIENT, page: 3, pageSize: 5 });
    const json = await res.json();
    expect(json.data).toEqual([{ occurrence_id: 'o1' }]);
    expect(json.meta.pagination ?? json.pagination).toMatchObject({ page: 3, limit: 5, total: 41 });
  });

  it('occurrences of an unknown definition is a 404, not an empty page', async () => {
    actions.getRecurringTicketDefinition.mockResolvedValue({ actionError: 'nf', messageKey: `${K}definitionNotFound` });
    const res = await makeController().occurrences()(req(`${BASE}/${DEF}/occurrences`));
    expect(res.status).toBe(404);
    expect(actions.listRecurringTicketOccurrences).not.toHaveBeenCalled();
  });

  it('upcoming builds the preview draft from the saved definition and adds definition_status', async () => {
    actions.getRecurringTicketDefinition.mockResolvedValue(detail({ is_active: false }));
    actions.previewRecurringTicketOccurrences.mockResolvedValue({ occurrences: [], time_zone: 'America/Chicago', calendar: null, sample_title: null });
    const res = await makeController().upcoming()(req(`${BASE}/${DEF}/upcoming`));
    expect(actions.previewRecurringTicketOccurrences).toHaveBeenCalledWith({
      ticket_template_id: TEMPLATE,
      recurrence: definition().recurrence,
      start_date: '2027-03-01',
      create_time: '08:00',
      due_time: '17:00',
      lead_days: 30,
      non_business_day_policy: 'previous',
    });
    expect((await res.json()).data.definition_status).toBe('paused');
  });

  it('upcoming reports archived definitions as archived', async () => {
    actions.getRecurringTicketDefinition.mockResolvedValue(detail({ archived_at: '2027-01-01T00:00:00.000Z' }));
    actions.previewRecurringTicketOccurrences.mockResolvedValue({ occurrences: [] });
    const json = await (await makeController().upcoming()(req(`${BASE}/${DEF}/upcoming`))).json();
    expect(json.data.definition_status).toBe('archived');
  });
});
