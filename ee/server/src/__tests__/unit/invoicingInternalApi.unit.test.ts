import { describe, expect, it, vi } from 'vitest'

vi.mock('@ee/lib/extensions/installConfig', () => ({
  getInstallConfigByInstallId: vi.fn(),
}))

vi.mock('@ee/lib/extensions/invoicingHostApi', () => ({
  createManualInvoice: vi.fn(),
}))

vi.mock('@ee/lib/extensions/invoicingValidation', () => ({
  validateCreateManualInvoiceInput: vi.fn(),
}))

vi.mock('server/src/lib/db', async () => {
  return {
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<unknown>) => fn()),
  }
})

describe('Invoicing internal API tenant context', () => {
  it('wraps createManualInvoice in runWithTenant(config.tenantId)', async () => {
    process.env.RUNNER_SERVICE_TOKEN = 'runner-test-token'

    const { getInstallConfigByInstallId } = await import('@ee/lib/extensions/installConfig')
    const { validateCreateManualInvoiceInput } = await import('@ee/lib/extensions/invoicingValidation')
    const { createManualInvoice } = await import('@ee/lib/extensions/invoicingHostApi')
    const { runWithTenant } = await import('server/src/lib/db')

    vi.mocked(getInstallConfigByInstallId).mockResolvedValue({
      tenantId: 'tenant-1',
      installId: 'install-1',
      versionId: 'version-1',
      registryId: 'registry-1',
      providers: ['cap:invoice.manual.create'],
    } as any)

    vi.mocked(validateCreateManualInvoiceInput).mockReturnValue({
      ok: true,
      value: {
        clientId: 'client-1',
        items: [{ serviceId: 'service-1', quantity: 1, description: 'Item', rate: 100 }],
      },
    } as any)

    vi.mocked(createManualInvoice).mockResolvedValue({ success: true, invoice: {} } as any)

    const { handleInternalInvoicingInstallRequest } = await import('@ee/lib/extensions/invoicingInternalApi')

    const res = await handleInternalInvoicingInstallRequest({
      installId: 'install-1',
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'createManualInvoice', clientId: 'client-1', items: [] },
    })

    expect(res.status).toBe(201)
    expect(vi.mocked(runWithTenant)).toHaveBeenCalledWith('tenant-1', expect.any(Function))
    expect(vi.mocked(createManualInvoice)).toHaveBeenCalledTimes(1)
  })
})

