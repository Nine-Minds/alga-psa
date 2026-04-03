import { z } from 'zod'

import { hasPermission } from '@alga-psa/auth/rbac'
import { getInstallConfigByInstallId } from '@ee/lib/extensions/installConfig'
import { CAP_SERVICE_READ, normalizeCapability } from '@ee/lib/extensions/providers'
import { getServiceSummaryById, listServiceSummaries } from '@ee/lib/extensions/serviceReadService'

export type ServicesInternalResponse = { status: number; body: any }

class ServicesInternalError extends Error {
  code: string
  status: number

  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'ServicesInternalError'
    this.code = code
    this.status = status
  }
}

const operationSchema = z.object({
  operation: z.enum(['list', 'get']),
})

const listInputSchema = z.object({
  search: z.string().max(200).optional(),
  itemKind: z.enum(['service', 'product']).optional(),
  isActive: z.boolean().optional(),
  billingMethod: z.enum(['fixed', 'hourly', 'usage']).optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

const getInputSchema = z.object({
  serviceId: z.string().uuid(),
})

const userSchema = z.object({
  userId: z.string().min(1),
  userType: z.string().min(1),
}).optional()

function ensureRunnerAuth(headers: Headers): void {
  const expected = process.env.RUNNER_STORAGE_API_TOKEN || process.env.RUNNER_SERVICE_TOKEN
  if (!expected) {
    throw new ServicesInternalError('UNAUTHORIZED', 401, 'Runner token not configured')
  }
  const provided = headers.get('x-runner-auth')
  if (!provided || provided !== expected) {
    throw new ServicesInternalError('UNAUTHORIZED', 401, 'Invalid runner token')
  }
}

async function assertServiceReadAllowedForUser(tenantId: string, rawUser: unknown): Promise<void> {
  const user = userSchema.parse(rawUser)
  if (!user) {
    return
  }

  const allowed = await hasPermission(
    {
      user_id: user.userId,
      user_type: user.userType,
      tenant: tenantId,
    } as any,
    'service',
    'read',
  )

  if (!allowed) {
    throw new ServicesInternalError('NOT_ALLOWED', 403, 'Permission denied: service:read not granted')
  }
}

export async function handleInternalServicesInstallRequest(params: {
  installId: string
  headers: Headers
  body: unknown
}): Promise<ServicesInternalResponse> {
  try {
    ensureRunnerAuth(params.headers)

    const base = operationSchema.parse(params.body)

    const config = await getInstallConfigByInstallId(params.installId)
    if (!config) {
      return { status: 404, body: { error: 'Install not found', code: 'NOT_FOUND' } }
    }

    const hasCap = config.providers.includes(normalizeCapability(CAP_SERVICE_READ))
    if (!hasCap) {
      return {
        status: 403,
        body: { error: `Permission denied: ${CAP_SERVICE_READ} not granted`, code: 'NOT_ALLOWED' },
      }
    }

    await assertServiceReadAllowedForUser(config.tenantId, (params.body as any)?.user)

    if (base.operation === 'list') {
      const listInput = listInputSchema.parse((params.body as any)?.input ?? {})
      const result = await listServiceSummaries(config.tenantId, listInput)
      console.info('[ext-services] list', {
        tenantId: config.tenantId,
        extension: config.extensionSlug ?? config.registryId,
        installId: config.installId,
        operation: 'list',
        resultCount: result.items.length,
      })
      return { status: 200, body: result }
    }

    const getInput = getInputSchema.parse((params.body as any)?.input ?? {})
    const item = await getServiceSummaryById(config.tenantId, getInput.serviceId)
    console.info('[ext-services] get', {
      tenantId: config.tenantId,
      extension: config.extensionSlug ?? config.registryId,
      installId: config.installId,
      operation: 'get',
      found: Boolean(item),
    })
    return { status: 200, body: { item } }
  } catch (error: any) {
    if (error instanceof ServicesInternalError) {
      return { status: error.status, body: { error: error.message, code: error.code } }
    }

    if (error instanceof z.ZodError) {
      return {
        status: 400,
        body: {
          error: 'Invalid request payload',
          code: 'INVALID_INPUT',
          details: error.flatten(),
        },
      }
    }

    return {
      status: 500,
      body: { error: 'Internal error', code: 'INTERNAL_ERROR' },
    }
  }
}
