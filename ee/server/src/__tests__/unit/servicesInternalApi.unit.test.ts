import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ee/lib/extensions/installConfig', () => ({
  getInstallConfigByInstallId: vi.fn(),
}))

vi.mock('@ee/lib/extensions/serviceReadService', () => ({
  listServiceSummaries: vi.fn(),
  getServiceSummaryById: vi.fn(),
}))

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(),
}))

describe('servicesInternalApi', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RUNNER_SERVICE_TOKEN = 'runner-test-token'
  })

  it('T006: returns not-allowed when cap:service.read is missing', async () => {
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: [],
    } as any)

    const { handleInternalServicesInstallRequest } = await import('@ee/lib/extensions/servicesInternalApi')
    const res = await handleInternalServicesInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'list', input: {} },
    })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('NOT_ALLOWED')
  })

  it('T009/T022: user-backed list succeeds with service:read and emits structured log', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    const { listServiceSummaries } = await import('@ee/lib/extensions/serviceReadService')
    const { hasPermission } = await import('@alga-psa/auth/rbac')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      extensionSlug: 'publisher.extension',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:service.read'],
    } as any)

    vi.mocked(hasPermission).mockResolvedValue(true)
    vi.mocked(listServiceSummaries).mockResolvedValue({
      items: [{
        serviceId: '11111111-1111-4111-8111-111111111111',
        serviceName: 'Managed Monitoring',
        itemKind: 'service',
        billingMethod: 'fixed',
        serviceTypeId: '22222222-2222-4222-8222-222222222222',
        serviceTypeName: 'Managed',
        defaultRate: 150,
        unitOfMeasure: 'month',
        isActive: true,
        sku: 'MON-001',
      }],
      totalCount: 1,
      page: 1,
      pageSize: 25,
    })

    const { handleInternalServicesInstallRequest } = await import('@ee/lib/extensions/servicesInternalApi')
    const res = await handleInternalServicesInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: {
        operation: 'list',
        input: { search: 'monitoring', itemKind: 'service', page: 1, pageSize: 25 },
        user: { userId: 'user-1', userType: 'msp' },
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.totalCount).toBe(1)
    expect(vi.mocked(hasPermission)).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', user_type: 'msp', tenant: 'tenant-1' }),
      'service',
      'read',
    )
    expect(logSpy).toHaveBeenCalledWith(
      '[ext-services] list',
      expect.objectContaining({ tenantId: 'tenant-1', operation: 'list', resultCount: 1 }),
    )
  })

  it('T010: user-backed list fails when service:read permission is missing', async () => {
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    const { hasPermission } = await import('@alga-psa/auth/rbac')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:service.read'],
    } as any)
    vi.mocked(hasPermission).mockResolvedValue(false)

    const { handleInternalServicesInstallRequest } = await import('@ee/lib/extensions/servicesInternalApi')
    const res = await handleInternalServicesInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'list', input: {}, user: { userId: 'user-1', userType: 'msp' } },
    })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('NOT_ALLOWED')
  })

  it('T012/T014: non-user list is allowed and tenant scope is install-derived', async () => {
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    const { listServiceSummaries } = await import('@ee/lib/extensions/serviceReadService')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-from-install',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:service.read'],
    } as any)
    vi.mocked(listServiceSummaries).mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 25 })

    const { handleInternalServicesInstallRequest } = await import('@ee/lib/extensions/servicesInternalApi')
    const res = await handleInternalServicesInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'list', input: { tenantId: 'malicious', page: 1, pageSize: 25 } },
    })

    expect(res.status).toBe(200)
    expect(vi.mocked(listServiceSummaries)).toHaveBeenCalledWith(
      'tenant-from-install',
      expect.objectContaining({ page: 1, pageSize: 25 }),
    )
  })

  it('T018: invalid service filters return invalid-input', async () => {
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:service.read'],
    } as any)

    const { handleInternalServicesInstallRequest } = await import('@ee/lib/extensions/servicesInternalApi')
    const res = await handleInternalServicesInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'list', input: { itemKind: 'invalid-kind', pageSize: 0 } },
    })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_INPUT')
  })

  it('T020: get returns null for missing service', async () => {
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    const { getServiceSummaryById } = await import('@ee/lib/extensions/serviceReadService')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:service.read'],
    } as any)
    vi.mocked(getServiceSummaryById).mockResolvedValue(null)

    const { handleInternalServicesInstallRequest } = await import('@ee/lib/extensions/servicesInternalApi')
    const res = await handleInternalServicesInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'get', input: { serviceId: '11111111-1111-4111-8111-111111111111' } },
    })

    expect(res.status).toBe(200)
    expect(res.body.item).toBeNull()
  })
})
