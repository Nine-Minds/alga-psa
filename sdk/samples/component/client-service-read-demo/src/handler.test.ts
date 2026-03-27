import { describe, expect, it, vi } from 'vitest'

import { createMockHostBindings } from '../../../../extension-runtime/src/index.ts'

import { handler } from './handler.ts'
import { fetchSummaryViaUiProxy } from './uiProxy.ts'

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

  it('T025: ui proxy summary path returns same read-only summary data as direct summary path', async () => {
    const directHost = createMockHostBindings({
      clients: {
        list: vi.fn().mockResolvedValue({ items: [{ clientId: 'c-1', clientName: 'Acme', clientType: null, isInactive: false, defaultCurrencyCode: 'USD', accountManagerId: null, accountManagerName: null, billingEmail: null }], totalCount: 1, page: 1, pageSize: 10 }),
        get: vi.fn(),
      },
      services: {
        list: vi.fn().mockResolvedValue({ items: [{ serviceId: 's-1', serviceName: 'Monitoring', itemKind: 'service', billingMethod: 'fixed', serviceTypeId: null, serviceTypeName: null, defaultRate: 100, unitOfMeasure: 'month', isActive: true, sku: null }], totalCount: 1, page: 1, pageSize: 10 }),
        get: vi.fn(),
      },
      user: {
        getUser: vi.fn().mockResolvedValue({ tenantId: 'tenant-1', clientName: 'Acme', userId: 'user-1', userEmail: 'u@example.com', userName: 'User One', userType: 'msp' }),
      },
    })

    const directResponse = await handler(makeRequest('/api/summary') as any, directHost)
    const directJson = decodeJson(directResponse)

    const proxyHost = createMockHostBindings({
      uiProxy: {
        callRoute: vi.fn(async (route: string) => {
          const proxied = await handler(makeRequest(route) as any, directHost)
          return proxied.body ?? new Uint8Array()
        }),
        call: vi.fn(),
      },
    })

    const proxiedJson = await fetchSummaryViaUiProxy(proxyHost.uiProxy)

    expect(proxiedJson).toEqual(directJson)
    expect(proxiedJson.clients.items[0]).toEqual(directJson.clients.items[0])
    expect(proxiedJson.services.items[0]).toEqual(directJson.services.items[0])
  })
})
