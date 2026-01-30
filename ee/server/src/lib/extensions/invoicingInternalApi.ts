import { CAP_INVOICE_MANUAL_CREATE, normalizeCapability } from '@ee/lib/extensions/providers'
import { getInstallConfigByInstallId } from '@ee/lib/extensions/installConfig'
import { createManualInvoice } from '@ee/lib/extensions/invoicingHostApi'
import { validateCreateManualInvoiceInput } from '@ee/lib/extensions/invoicingValidation'
import { runWithTenant } from 'server/src/lib/db'

export type InvoicingInternalResponse = { status: number; body: any }

class InvoicingInternalError extends Error {
  code: string
  status: number

  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'InvoicingInternalError'
    this.code = code
    this.status = status
  }
}

function ensureRunnerAuth(headers: Headers): void {
  const expected = process.env.RUNNER_STORAGE_API_TOKEN || process.env.RUNNER_SERVICE_TOKEN
  if (!expected) {
    throw new InvoicingInternalError('UNAUTHORIZED', 401, 'Runner token not configured')
  }
  const provided = headers.get('x-runner-auth')
  if (!provided || provided !== expected) {
    throw new InvoicingInternalError('UNAUTHORIZED', 401, 'Invalid runner token')
  }
}

export async function handleInternalInvoicingInstallRequest(params: {
  installId: string
  headers: Headers
  body: unknown
}): Promise<InvoicingInternalResponse> {
  try {
    ensureRunnerAuth(params.headers)

    const raw = params.body
    const op = (raw as any)?.operation
    if (op !== 'createManualInvoice') {
      return { status: 400, body: { error: 'Unsupported operation' } }
    }

    const config = await getInstallConfigByInstallId(params.installId)
    if (!config) {
      return { status: 404, body: { error: 'Install not found' } }
    }

    const hasCap = config.providers.includes(normalizeCapability(CAP_INVOICE_MANUAL_CREATE))
    if (!hasCap) {
      return { status: 403, body: { success: false, error: `Permission denied: ${CAP_INVOICE_MANUAL_CREATE} not granted` } }
    }

    const validated = validateCreateManualInvoiceInput(raw)
    if (validated.ok === false) {
      return {
        status: 400,
        body: { success: false, error: validated.error, fieldErrors: validated.fieldErrors },
      }
    }

    const result = await runWithTenant(config.tenantId, async () =>
      createManualInvoice(
        {
          tenantId: config.tenantId,
          installId: config.installId,
          versionId: config.versionId,
          registryId: config.registryId,
        },
        validated.value
      )
    )

    return { status: result.success ? 201 : 400, body: result }
  } catch (error: any) {
    if (error instanceof InvoicingInternalError) {
      return { status: error.status, body: { error: error.message, code: error.code } }
    }
    return { status: 500, body: { error: 'Internal error', code: 'INTERNAL_ERROR' } }
  }
}
