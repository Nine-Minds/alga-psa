/**
 * Bulk contract-line deletes over the v1 API (alga-2026-0002902).
 *
 * `DELETE /api/v1/contract-lines/bulk/delete` and `.../bulk/remove-services`
 * started with a bare `await req.json()`, so a bodyless DELETE — which is what
 * our own agent tooling, the MCP connector and plenty of HTTP clients send —
 * threw a SyntaxError that handleApiError turned into a 500. The ids are now
 * read defensively: body, else the query string on DELETE, else a 400 that
 * names the expected shape. A POST alias covers clients that cannot attach a
 * body to a DELETE at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  bulkDeleted: [] as Array<{ contract_line_ids: string[] }>,
  removed: [] as Array<[string, string]>,
}));

vi.mock('@/lib/api/services/ContractLineService', () => ({
  ContractLineService: class {
    async bulkDeleteContractLines(data: { contract_line_ids: string[] }) {
      state.bulkDeleted.push(data);
    }
    async removeServiceFromPlan(planId: string, serviceId: string) {
      state.removed.push([planId, serviceId]);
    }
  },
}));

const { ApiContractLineController } = await import('@/lib/api/controllers/ApiContractLineController');

const LINE_A = '11111111-1111-4111-8111-111111111111';
const LINE_B = '22222222-2222-4222-8222-222222222222';
const SERVICE_A = '33333333-3333-4333-8333-333333333333';
const SERVICE_B = '44444444-4444-4444-8444-444444444444';

function authedRequest(url: string, init: RequestInit = {}): NextRequest {
  const req = new NextRequest(new Request(url, init));
  (req as unknown as { context: unknown }).context = {
    tenant: 'tenant-1',
    user: { user_id: 'user-1' },
  };
  return req;
}

async function callBulkDelete(url: string, init: RequestInit = {}) {
  const response = await new ApiContractLineController().bulkDeleteContractLines()(
    authedRequest(url, init),
  );
  return { status: response.status, body: await response.json() };
}

async function callRemoveServices(url: string, init: RequestInit = {}) {
  const response = await new ApiContractLineController().bulkRemoveServicesFromContractLine()(
    authedRequest(url, init),
  );
  return { status: response.status, body: await response.json() };
}

const DELETE_URL = 'http://localhost/api/v1/contract-lines/bulk/delete';
const REMOVE_URL = 'http://localhost/api/v1/contract-lines/bulk/remove-services';
const JSON_HEADERS = { 'content-type': 'application/json' };

beforeEach(() => {
  state.bulkDeleted = [];
  state.removed = [];
});

describe('bulk delete contract lines', () => {
  it('answers 400 naming the expected body when a DELETE carries none', async () => {
    const { status, body } = await callBulkDelete(DELETE_URL, { method: 'DELETE' });

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('contract_line_ids');
    expect(state.bulkDeleted).toEqual([]);
  });

  it('answers 400 for an unparseable body', async () => {
    const { status, body } = await callBulkDelete(DELETE_URL, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: '{nope',
    });

    expect(status).toBe(400);
    expect(body.error.message).toBe('Request body must be valid JSON');
  });

  it('deletes from a DELETE body as before', async () => {
    const { status, body } = await callBulkDelete(DELETE_URL, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ contract_line_ids: [LINE_A, LINE_B] }),
    });

    expect(status).toBe(200);
    expect(body.meta.count).toBe(2);
    expect(state.bulkDeleted).toEqual([{ contract_line_ids: [LINE_A, LINE_B] }]);
  });

  it('deletes from the comma-separated query string on DELETE', async () => {
    const { status } = await callBulkDelete(
      `${DELETE_URL}?contract_line_ids=${LINE_A},${LINE_B}`,
      { method: 'DELETE' },
    );

    expect(status).toBe(200);
    expect(state.bulkDeleted).toEqual([{ contract_line_ids: [LINE_A, LINE_B] }]);
  });

  it('deletes from the POST alias body', async () => {
    const { status } = await callBulkDelete(DELETE_URL, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ contract_line_ids: [LINE_A] }),
    });

    expect(status).toBe(200);
    expect(state.bulkDeleted).toEqual([{ contract_line_ids: [LINE_A] }]);
  });

  it('still rejects ids that are not UUIDs', async () => {
    const { status, body } = await callBulkDelete(`${DELETE_URL}?contract_line_ids=not-a-uuid`, {
      method: 'DELETE',
    });

    expect(status).toBe(400);
    expect(body.error.message).toBe('Invalid request data');
  });
});

describe('bulk remove services from a contract line', () => {
  it('answers 400 naming the expected body when a DELETE carries none', async () => {
    const { status, body } = await callRemoveServices(REMOVE_URL, { method: 'DELETE' });

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('contract_line_id');
    expect(body.error.message).toContain('service_ids');
    expect(state.removed).toEqual([]);
  });

  it('removes services from a DELETE body as before', async () => {
    const { status, body } = await callRemoveServices(REMOVE_URL, {
      method: 'DELETE',
      headers: JSON_HEADERS,
      body: JSON.stringify({ contract_line_id: LINE_A, service_ids: [SERVICE_A, SERVICE_B] }),
    });

    expect(status).toBe(200);
    expect(body.data).toEqual([
      { success: true, service_id: SERVICE_A },
      { success: true, service_id: SERVICE_B },
    ]);
    expect(state.removed).toEqual([
      [LINE_A, SERVICE_A],
      [LINE_A, SERVICE_B],
    ]);
  });

  it('removes services named in the query string on DELETE', async () => {
    const { status } = await callRemoveServices(
      `${REMOVE_URL}?contract_line_id=${LINE_A}&service_ids=${SERVICE_A},${SERVICE_B}`,
      { method: 'DELETE' },
    );

    expect(status).toBe(200);
    expect(state.removed).toEqual([
      [LINE_A, SERVICE_A],
      [LINE_A, SERVICE_B],
    ]);
  });

  it('removes services from the POST alias body', async () => {
    const { status } = await callRemoveServices(REMOVE_URL, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ contract_line_id: LINE_A, service_ids: [SERVICE_A] }),
    });

    expect(status).toBe(200);
    expect(state.removed).toEqual([[LINE_A, SERVICE_A]]);
  });
});
