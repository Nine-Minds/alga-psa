import { describe, expect, it, vi } from 'vitest'

import { createMockHostBindings } from '@alga-psa/extension-runtime'

import { handler } from './handler.ts'

function decodeJson(response: { body?: Uint8Array | null }) {
  return JSON.parse(new TextDecoder().decode(response.body ?? new Uint8Array()))
}

function makeRequest(url: string) {
  return {
    context: {
      tenantId: 'tenant-1',
      extensionId: 'com.alga.sample.client-service-read-demo',
      requestId: 'req-1',
    },
    http: {
      method: 'GET',
      url,
      headers: [],
    },
  }
}

describe('client-service-read-demo', () => {
  it('T023: lists clients via host capability without http.fetch', async () => {
    const host = createMockHostBindings({
      clients: {
        list: vi.fn().mockResolvedValue({ items: [{ clientId: 'c-1', clientName: 'Acme', clientType: null, isInactive: false, defaultCurrencyCode: 'USD', accountManagerId: null, accountManagerName: null, billingEmail: null }], totalCount: 1, page: 1, pageSize: 10 }),
        get: vi.fn(),
      },
      services: {
        list: vi.fn().mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 10 }),
        get: vi.fn(),
      },
      http: { fetch: vi.fn() },
    })

    const res = await handler(makeRequest('/api/clients') as any, host)
    const body = decodeJson(res)

    expect(res.status).toBe(200)
    expect(host.clients.list).toHaveBeenCalledTimes(1)
    expect(host.http.fetch).not.toHaveBeenCalled()
    expect(body.clients.totalCount).toBe(1)
  })

  it('T024: lists services via host capability without http.fetch', async () => {
    const host = createMockHostBindings({
      clients: {
        list: vi.fn().mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 10 }),
        get: vi.fn(),
      },
      services: {
        list: vi.fn().mockResolvedValue({ items: [{ serviceId: 's-1', serviceName: 'Monitoring', itemKind: 'service', billingMethod: 'fixed', serviceTypeId: null, serviceTypeName: null, defaultRate: 100, unitOfMeasure: 'month', isActive: true, sku: null }], totalCount: 1, page: 1, pageSize: 10 }),
        get: vi.fn(),
      },
      http: { fetch: vi.fn() },
    })

    const res = await handler(makeRequest('/api/services') as any, host)
    const body = decodeJson(res)

    expect(res.status).toBe(200)
    expect(host.services.list).toHaveBeenCalledTimes(1)
    expect(host.http.fetch).not.toHaveBeenCalled()
    expect(body.services.totalCount).toBe(1)
  })

  it('T025: returns not_found for removed summary route', async () => {
    const host = createMockHostBindings()

    const res = await handler(makeRequest('/api/summary') as any, host)
    const body = decodeJson(res)

    expect(res.status).toBe(404)
    expect(body).toEqual({ error: 'not_found' })
  })
})
