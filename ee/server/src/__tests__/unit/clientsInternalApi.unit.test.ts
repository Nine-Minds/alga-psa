import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@ee/lib/extensions/installConfig', () => ({
  getInstallConfigByInstallId: vi.fn(),
}))

vi.mock('@ee/lib/extensions/clientReadService', () => ({
  listClientSummaries: vi.fn(),
  getClientSummaryById: vi.fn(),
}))

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(),
}))

describe('clientsInternalApi', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.RUNNER_SERVICE_TOKEN = 'runner-test-token'
  })

  it('T005: returns not-allowed when cap:client.read is missing', async () => {
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: [],
    } as any)

    const { handleInternalClientsInstallRequest } = await import('@ee/lib/extensions/clientsInternalApi')
    const res = await handleInternalClientsInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'list', input: {} },
    })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('NOT_ALLOWED')
  })

  it('T007/T021: user-backed list succeeds with client:read and emits structured log', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    const { listClientSummaries } = await import('@ee/lib/extensions/clientReadService')
    const { hasPermission } = await import('@alga-psa/auth/rbac')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      extensionSlug: 'publisher.extension',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:client.read'],
    } as any)

    vi.mocked(hasPermission).mockResolvedValue(true)
    vi.mocked(listClientSummaries).mockResolvedValue({
      items: [{
        clientId: '11111111-1111-4111-8111-111111111111',
        clientName: 'Acme',
        clientType: 'company',
        isInactive: false,
        defaultCurrencyCode: 'USD',
        accountManagerId: null,
        accountManagerName: null,
        billingEmail: null,
      }],
      totalCount: 1,
      page: 1,
      pageSize: 25,
    })

    const { handleInternalClientsInstallRequest } = await import('@ee/lib/extensions/clientsInternalApi')
    const res = await handleInternalClientsInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: {
        operation: 'list',
        input: { search: 'acme', page: 1, pageSize: 25 },
        user: { userId: 'user-1', userType: 'msp' },
      },
    })

    expect(res.status).toBe(200)
    expect(res.body.totalCount).toBe(1)
    expect(vi.mocked(hasPermission)).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', user_type: 'msp', tenant: 'tenant-1' }),
      'client',
      'read',
    )
    expect(logSpy).toHaveBeenCalledWith(
      '[ext-clients] list',
      expect.objectContaining({ tenantId: 'tenant-1', operation: 'list', resultCount: 1 }),
    )
  })

  it('T008: user-backed list fails when client:read permission is missing', async () => {
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    const { hasPermission } = await import('@alga-psa/auth/rbac')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:client.read'],
    } as any)
    vi.mocked(hasPermission).mockResolvedValue(false)

    const { handleInternalClientsInstallRequest } = await import('@ee/lib/extensions/clientsInternalApi')
    const res = await handleInternalClientsInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'list', input: {}, user: { userId: 'user-1', userType: 'msp' } },
    })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('NOT_ALLOWED')
  })

  it('T011/T013: non-user list is allowed and tenant scope is install-derived', async () => {
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    const { listClientSummaries } = await import('@ee/lib/extensions/clientReadService')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-from-install',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:client.read'],
    } as any)
    vi.mocked(listClientSummaries).mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 25 })

    const { handleInternalClientsInstallRequest } = await import('@ee/lib/extensions/clientsInternalApi')
    const res = await handleInternalClientsInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'list', input: { tenantId: 'malicious', page: 1, pageSize: 25 } },
    })

    expect(res.status).toBe(200)
    expect(vi.mocked(listClientSummaries)).toHaveBeenCalledWith(
      'tenant-from-install',
      expect.objectContaining({ page: 1, pageSize: 25 }),
    )
  })

  it('T017: invalid page/pageSize returns invalid-input', async () => {
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:client.read'],
    } as any)

    const { handleInternalClientsInstallRequest } = await import('@ee/lib/extensions/clientsInternalApi')
    const res = await handleInternalClientsInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'list', input: { page: 0, pageSize: 500 } },
    })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_INPUT')
  })

  it('T019: get returns null for missing client', async () => {
    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    const { getClientSummaryById } = await import('@ee/lib/extensions/clientReadService')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:client.read'],
    } as any)
    vi.mocked(getClientSummaryById).mockResolvedValue(null)

    const { handleInternalClientsInstallRequest } = await import('@ee/lib/extensions/clientsInternalApi')
    const res = await handleInternalClientsInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'get', input: { clientId: '11111111-1111-4111-8111-111111111111' } },
    })

    expect(res.status).toBe(200)
    expect(res.body.item).toBeNull()
  })
})
