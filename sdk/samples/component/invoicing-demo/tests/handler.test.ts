import { describe, expect, it, vi } from 'vitest';
import { handler } from '../src/handler.js';
import { createMockHostBindings, ExecuteRequest } from '@alga-psa/extension-runtime';

function makeRequest(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    context: {
      tenantId: 'tenant-123',
      extensionId: 'com.alga.sample.invoicing-demo',
      requestId: 'req-1',
      ...overrides.context,
    },
    http: {
      method: 'GET',
      url: '/api/status',
      headers: [],
      ...overrides.http,
    },
  };
}

describe('invoicing-demo handler', () => {
  it('returns status for GET /api/status', async () => {
    const host = createMockHostBindings({
      logging: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const response = await handler(makeRequest(), host);
    expect(response.status).toBe(200);
    const json = JSON.parse(new TextDecoder().decode(response.body ?? new Uint8Array()));
    expect(json.status).toBe('healthy');
    expect(json.tenant).toBe('tenant-123');
  });

  it('validates input and calls host.invoicing.createManualInvoice', async () => {
    const createManualInvoice = vi.fn().mockResolvedValue({
      success: true,
      invoice: {
        invoiceId: 'inv-1',
        invoiceNumber: 'INV-0001',
        status: 'draft',
        subtotal: 100,
        tax: 0,
        total: 100,
      },
    });

    const host = createMockHostBindings({
      logging: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      invoicing: { createManualInvoice },
    });

    const body = {
      clientId: 'client-1',
      invoiceDate: '2026-01-14',
      dueDate: '2026-01-14',
      poNumber: 'PO-123',
      items: [{ serviceId: 'svc-1', quantity: 2, description: 'Work', rate: 5000 }],
    };

    const response = await handler(
      makeRequest({
        http: {
          method: 'POST',
          url: '/api/create-manual-invoice',
          body: new TextEncoder().encode(JSON.stringify(body)),
        },
      }),
      host
    );

    expect(response.status).toBe(200);
    expect(createManualInvoice).toHaveBeenCalledTimes(1);
    expect(createManualInvoice).toHaveBeenCalledWith({
      clientId: 'client-1',
      invoiceDate: '2026-01-14',
      dueDate: '2026-01-14',
      poNumber: 'PO-123',
      items: [{ serviceId: 'svc-1', quantity: 2, description: 'Work', rate: 5000 }],
    });
  });

  it('returns 400 with fieldErrors for missing clientId/items', async () => {
    const host = createMockHostBindings({
      logging: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      invoicing: { createManualInvoice: vi.fn() },
    });

    const response = await handler(
      makeRequest({
        http: {
          method: 'POST',
          url: '/api/create-manual-invoice',
          body: new TextEncoder().encode(JSON.stringify({ items: [] })),
        },
      }),
      host
    );

    expect(response.status).toBe(400);
    const json = JSON.parse(new TextDecoder().decode(response.body ?? new Uint8Array()));
    expect(json.success).toBe(false);
    expect(json.fieldErrors.clientId).toBeDefined();
    expect(json.fieldErrors.items).toBeDefined();
  });

  it('returns 404 for unknown routes', async () => {
    const host = createMockHostBindings({
      logging: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const response = await handler(makeRequest({ http: { method: 'GET', url: '/nope' } }), host);
    expect(response.status).toBe(404);
  });
});

