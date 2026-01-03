/**
 * Scheduler Host API for Extensions
 *
 * Internal API for extensions to manage their own scheduled tasks via the
 * cap:scheduler.manage capability. These functions are called by the Runner
 * on behalf of extensions and are scoped to the calling extension's install.
 *
 * Unlike the admin-facing extensionScheduleActions.ts, these functions:
 * - Accept install context (tenantId, installId) directly instead of using getCurrentUser()
 * - Resolve endpoints by path instead of requiring endpoint UUIDs
 * - Return structured results suitable for the WASM boundary
 */

import crypto from 'node:crypto'
import type { Knex } from 'knex'
import { metrics } from '@opentelemetry/api'
import logger from '@shared/core/logger'
import { getConnection } from '@/lib/db/db'

import { getInstallConfigByInstallId } from './installConfig'
import { getJobRunnerInstance, initializeJobRunner } from 'server/src/lib/jobs/initializeJobRunner'

// Metrics for scheduler host API operations
const meter = metrics.getMeter('alga-psa-extensions')

const schedulerApiCounter = meter.createCounter('extension_scheduler_api_calls_total', {
  description: 'Total number of extension scheduler API calls',
})

const schedulerApiDuration = meter.createHistogram('extension_scheduler_api_duration_seconds', {
  description: 'Duration of extension scheduler API calls in seconds',
  unit: 's',
})

const schedulerApiErrors = meter.createCounter('extension_scheduler_api_errors_total', {
  description: 'Total number of extension scheduler API errors',
})

function recordMetric(operation: string, tenantId: string, success: boolean, durationMs: number): void {
  try {
    const attributes = { operation, tenant_id: tenantId }
    schedulerApiCounter.add(1, attributes)
    schedulerApiDuration.record(durationMs / 1000, attributes)
    if (!success) {
      schedulerApiErrors.add(1, attributes)
    }
  } catch {
    // Swallow metrics errors to avoid disrupting API flow
  }
}

// Types matching the SDK definitions

export interface ScheduleInfo {
  id: string
  endpointPath: string
  endpointMethod: string
  name?: string | null
  cron: string
  timezone: string
  enabled: boolean
  payload?: unknown
  lastRunAt?: string | null
  lastRunStatus?: string | null
  lastError?: string | null
  createdAt?: string | null
}

export interface EndpointInfo {
  id: string
  method: string
  path: string
  handler: string
  schedulable: boolean
}

export interface CreateScheduleInput {
  endpoint: string
  cron: string
  timezone?: string
  enabled?: boolean
  name?: string
  payload?: unknown
}

export interface CreateScheduleResult {
  success: boolean
  scheduleId?: string
  error?: string
  fieldErrors?: Record<string, string>
}

export interface UpdateScheduleInput {
  endpoint?: string
  cron?: string
  timezone?: string
  enabled?: boolean
  name?: string | null
  payload?: unknown | null
}

export interface UpdateScheduleResult {
  success: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

export interface DeleteScheduleResult {
  success: boolean
  error?: string
}

export interface InstallContext {
  tenantId: string
  installId: string
  versionId: string
  registryId: string
}

// Validation helpers

class SchedulerInputError extends Error {
  field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = 'SchedulerInputError'
    this.field = field
  }
}

function failField(field: string, message: string): never {
  throw new SchedulerInputError(field, message)
}

function validateCronExpression(cron: string): string {
  const value = String(cron || '').trim()
  if (value.length > 128) {
    failField('cron', 'Cron expression too long')
  }
  const parts = value.split(/\s+/).filter(Boolean)
  if (parts.length !== 5) {
    failField('cron', 'Invalid cron expression (expected 5 fields: m h dom mon dow)')
  }
  for (const part of parts) {
    if (!/^[0-9*/,-]+$/.test(part)) {
      failField('cron', 'Invalid cron expression (unsupported characters)')
    }
  }
  const [min, hour, dom, mon, dow] = parts
  const domIsSet = dom !== '*'
  const dowIsSet = dow !== '*'
  if (domIsSet && dowIsSet) {
    failField('cron', 'Cron cannot set both day-of-month and day-of-week')
  }
  const allOtherStars = hour === '*' && dom === '*' && mon === '*' && dow === '*'
  if (allOtherStars) {
    if (min === '*' || min === '*/1' || min === '*/2' || min === '*/3' || min === '*/4') {
      failField('cron', 'Cron too frequent (minimum interval is 5 minutes)')
    }
  }
  return value
}

function validatePayloadJson(payload: unknown): unknown {
  if (payload === null || payload === undefined) return null
  const isArray = Array.isArray(payload)
  const isObject = typeof payload === 'object'
  if (!isArray && !isObject) {
    failField('payload', 'Payload must be a JSON object or array')
  }
  const json = JSON.stringify(payload)
  if (typeof json !== 'string') {
    failField('payload', 'Payload must be JSON-serializable')
  }
  if (json.length > 100_000) {
    failField('payload', 'Payload too large')
  }
  return payload
}

function validateTimezone(tz?: string): string {
  const value = String(tz || 'UTC').trim()
  if (!value) return 'UTC'
  if (value.length > 64) failField('timezone', 'Timezone too long')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
  } catch {
    failField('timezone', 'Invalid timezone')
  }
  return value
}

function validateUuid(id: string, fieldName: string): string {
  const v = String(id || '').trim()
  if (!v) throw new Error(`Missing ${fieldName}`)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) {
    failField(fieldName, `Invalid ${fieldName}`)
  }
  return v
}

function validateScheduleName(name: unknown): string | null {
  if (name === null || name === undefined) return null
  const value = String(name).trim()
  if (!value) return null
  if (value.length > 128) {
    failField('name', 'Name too long')
  }
  return value
}

function isNameUniqueViolation(error: unknown): boolean {
  const e: any = error as any
  const code = String(e?.code ?? '')
  const constraint = String(e?.constraint ?? '')
  if (code === '23505' && constraint === 'tenant_extension_schedule_install_name_uniq') return true
  return false
}

async function getRunner() {
  const existing = getJobRunnerInstance()
  if (existing) return existing
  return initializeJobRunner()
}

function scheduleSingletonKey(installId: string, scheduleId: string): string {
  return `extsched:${installId}:${scheduleId}`
}

// Endpoint resolution

async function resolveEndpointByPath(
  knex: Knex,
  versionId: string,
  path: string
): Promise<{ id: string; method: string; path: string } | null> {
  // Normalize path to have leading /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  const row = await knex('extension_api_endpoint')
    .where({ version_id: versionId })
    .andWhere(function () {
      this.where('path', normalizedPath).orWhere('path', normalizedPath.replace(/^\//, ''))
    })
    .whereIn('method', ['GET', 'POST'])
    .first(['id', 'method', 'path'])

  if (!row) return null

  // Check for path parameters
  const pathStr = String(row.path || '')
  if (pathStr.includes('/:') || pathStr.includes(':') || pathStr.includes('{') || pathStr.includes('}')) {
    return null // Not schedulable
  }

  return { id: row.id, method: String(row.method).toUpperCase(), path: pathStr }
}

// API Implementation

export async function listSchedules(ctx: InstallContext): Promise<ScheduleInfo[]> {
  const startTime = Date.now()
  let success = false

  try {
    const knex = await getConnection(ctx.tenantId)

    const rows = await knex('tenant_extension_schedule as s')
    .join('extension_api_endpoint as e', 'e.id', 's.endpoint_id')
    .where({ 's.tenant_id': ctx.tenantId, 's.install_id': ctx.installId })
    .orderBy([{ column: 's.created_at', order: 'asc' }])
    .select([
      's.id',
      's.name',
      's.cron',
      's.timezone',
      's.enabled',
      's.payload_json',
      's.last_run_at',
      's.last_run_status',
      's.last_error',
      's.created_at',
      'e.method as endpoint_method',
      'e.path as endpoint_path',
    ])

    const result = rows.map((row: any) => ({
      id: row.id,
      endpointPath: row.endpoint_path,
      endpointMethod: row.endpoint_method,
      name: row.name,
      cron: row.cron,
      timezone: row.timezone,
      enabled: Boolean(row.enabled),
      payload: row.payload_json,
      lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
      lastRunStatus: row.last_run_status,
      lastError: row.last_error,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    }))

    success = true
    return result
  } finally {
    recordMetric('list', ctx.tenantId, success, Date.now() - startTime)
  }
}

export async function getSchedule(ctx: InstallContext, scheduleId: string): Promise<ScheduleInfo | null> {
  const startTime = Date.now()
  let success = false

  try {
    const knex = await getConnection(ctx.tenantId)
    const id = validateUuid(scheduleId, 'scheduleId')

    const row = await knex('tenant_extension_schedule as s')
      .join('extension_api_endpoint as e', 'e.id', 's.endpoint_id')
      .where({ 's.id': id, 's.tenant_id': ctx.tenantId, 's.install_id': ctx.installId })
      .first([
        's.id',
        's.name',
        's.cron',
        's.timezone',
        's.enabled',
        's.payload_json',
        's.last_run_at',
        's.last_run_status',
        's.last_error',
        's.created_at',
        'e.method as endpoint_method',
        'e.path as endpoint_path',
      ])

    success = true
    if (!row) return null

    return {
      id: row.id,
      endpointPath: row.endpoint_path,
      endpointMethod: row.endpoint_method,
      name: row.name,
      cron: row.cron,
      timezone: row.timezone,
      enabled: Boolean(row.enabled),
      payload: row.payload_json,
      lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
      lastRunStatus: row.last_run_status,
      lastError: row.last_error,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    }
  } catch (error: any) {
    logger.error('Failed to get schedule', { ctx, scheduleId, error })
    return null
  } finally {
    recordMetric('get', ctx.tenantId, success, Date.now() - startTime)
  }
}

export async function createSchedule(
  ctx: InstallContext,
  input: CreateScheduleInput
): Promise<CreateScheduleResult> {
  const startTime = Date.now()
  let success = false

  try {
    const knex = await getConnection(ctx.tenantId)
    // Validate input
    const cron = validateCronExpression(input.cron)
    const timezone = validateTimezone(input.timezone)
    const enabled = typeof input.enabled === 'boolean' ? input.enabled : true
    const payload = validatePayloadJson(input.payload)
    const name = validateScheduleName(input.name)

    // Resolve endpoint by path
    const endpoint = await resolveEndpointByPath(knex, ctx.versionId, input.endpoint)
    if (!endpoint) {
      return { success: false, error: 'Endpoint not found or not schedulable', fieldErrors: { endpoint: 'Endpoint not found or not schedulable' } }
    }

    // Check quota
    const countRow = await knex('tenant_extension_schedule')
      .where({ tenant_id: ctx.tenantId, install_id: ctx.installId })
      .count<{ count: string }[]>({ count: '*' })
      .first()
    const count = Number((countRow as any)?.count ?? 0)
    if (count >= 50) {
      return { success: false, error: 'Too many schedules (max 50 per extension install)' }
    }

    const scheduleId = crypto.randomUUID()
    const now = knex.fn.now()

    // Create job runner schedule if enabled
    let jobId: string | null = null
    let externalId: string | null = null
    if (enabled) {
      const runner = await getRunner()
      const created = await runner.scheduleRecurringJob(
        'extension-scheduled-invocation',
        { tenantId: ctx.tenantId, installId: ctx.installId, scheduleId } as any,
        cron,
        {
          singletonKey: scheduleSingletonKey(ctx.installId, scheduleId),
          metadata: { kind: 'extension_schedule', scheduleId, timezone, trigger: 'host_api' },
        }
      )
      jobId = created.jobId ?? null
      externalId = (created as any).externalId ?? null
    }

    // Persist to database
    try {
      await knex.transaction(async (trx: Knex.Transaction) => {
        const row = {
          id: scheduleId,
          install_id: ctx.installId,
          tenant_id: ctx.tenantId,
          endpoint_id: endpoint.id,
          name,
          cron,
          timezone,
          enabled,
          payload_json: payload ?? null,
          job_id: enabled ? jobId : null,
          runner_schedule_id: enabled ? externalId : null,
          created_at: now,
          updated_at: now,
        }

        try {
          await trx('tenant_extension_schedule').insert(row)
        } catch (error) {
          if (isNameUniqueViolation(error)) {
            failField('name', 'Schedule name already in use for this extension')
          }
          throw error
        }

        await trx('tenant_extension_install')
          .where({ id: ctx.installId, tenant_id: ctx.tenantId })
          .update({ updated_at: trx.fn.now() })
      })
    } catch (e) {
      // Cleanup job runner schedule if DB insert failed
      if (enabled && jobId) {
        try {
          const runner = await getRunner()
          await runner.cancelJob(String(jobId), ctx.tenantId)
        } catch {
          // Best-effort cleanup
        }
      }
      throw e
    }

    logger.info('Extension created schedule via host API', {
      tenantId: ctx.tenantId,
      installId: ctx.installId,
      scheduleId,
      endpoint: input.endpoint,
    })

    success = true
    return { success: true, scheduleId }
  } catch (error: any) {
    logger.error('Failed to create schedule via host API', { ctx, input, error })
    if (error instanceof SchedulerInputError) {
      return { success: false, error: error.message, fieldErrors: { [error.field]: error.message } }
    }
    if (isNameUniqueViolation(error)) {
      return {
        success: false,
        error: 'Schedule name already in use for this extension',
        fieldErrors: { name: 'Schedule name already in use for this extension' },
      }
    }
    return { success: false, error: error?.message ?? 'Failed to create schedule' }
  } finally {
    recordMetric('create', ctx.tenantId, success, Date.now() - startTime)
  }
}

export async function updateSchedule(
  ctx: InstallContext,
  scheduleId: string,
  input: UpdateScheduleInput
): Promise<UpdateScheduleResult> {
  const startTime = Date.now()
  let success = false

  try {
    const knex = await getConnection(ctx.tenantId)
    const id = validateUuid(scheduleId, 'scheduleId')
    const nextCron = input.cron ? validateCronExpression(input.cron) : undefined
    const nextTimezone = input.timezone ? validateTimezone(input.timezone) : undefined
    const hasEnabledUpdate = typeof input.enabled === 'boolean'
    const payload =
      'payload' in input ? (input.payload === null ? null : validatePayloadJson(input.payload)) : undefined

    const now = knex.fn.now()

    // Get current schedule
    const current = await knex('tenant_extension_schedule')
      .where({ id, tenant_id: ctx.tenantId, install_id: ctx.installId })
      .first()

    if (!current) {
      return { success: false, error: 'Schedule not found' }
    }

    // Resolve new endpoint if provided
    let nextEndpointId: string | undefined
    if (input.endpoint) {
      const endpoint = await resolveEndpointByPath(knex, ctx.versionId, input.endpoint)
      if (!endpoint) {
        return { success: false, error: 'Endpoint not found or not schedulable', fieldErrors: { endpoint: 'Endpoint not found or not schedulable' } }
      }
      nextEndpointId = endpoint.id
    }

    const patch: any = { updated_at: now }
    if (nextEndpointId) patch.endpoint_id = nextEndpointId
    if (nextCron) patch.cron = nextCron
    if (nextTimezone) patch.timezone = nextTimezone
    if ('name' in input) patch.name = input.name === null ? null : validateScheduleName(input.name)
    if ('payload' in input) patch.payload_json = payload
    if (hasEnabledUpdate) patch.enabled = Boolean(input.enabled)

    const needsReschedule =
      (nextCron && nextCron !== current.cron) ||
      (hasEnabledUpdate && Boolean(input.enabled) !== Boolean(current.enabled)) ||
      (nextTimezone && nextTimezone !== current.timezone)

    if (needsReschedule) {
      const runner = await getRunner()
      const effectiveEnabled = hasEnabledUpdate ? Boolean(input.enabled) : Boolean(current.enabled)

      if (effectiveEnabled) {
        // Cancel existing and create new schedule
        const currentJobId = current.job_id ? String(current.job_id) : null
        if (currentJobId) {
          const cancelled = await runner.cancelJob(currentJobId, ctx.tenantId)
          if (!cancelled) {
            return { success: false, error: 'Failed to cancel existing schedule (cannot reschedule)' }
          }
        }

        const cron = nextCron ?? String(current.cron)
        const tz = nextTimezone ?? String(current.timezone)

        const scheduled = await runner.scheduleRecurringJob(
          'extension-scheduled-invocation',
          { tenantId: ctx.tenantId, installId: ctx.installId, scheduleId: id } as any,
          cron,
          {
            singletonKey: scheduleSingletonKey(ctx.installId, id),
            metadata: { kind: 'extension_schedule', scheduleId: id, timezone: tz, trigger: 'host_api' },
          }
        )

        patch.job_id = scheduled?.jobId ?? null
        patch.runner_schedule_id = (scheduled as any)?.externalId ?? null
      } else {
        // Disable: cancel schedule
        const currentJobId = current.job_id ? String(current.job_id) : null
        if (currentJobId) {
          const cancelled = await runner.cancelJob(currentJobId, ctx.tenantId)
          if (!cancelled) {
            return { success: false, error: 'Failed to cancel existing schedule (cannot disable)' }
          }
        }
        patch.job_id = null
        patch.runner_schedule_id = null
      }
    }

    // Update database
    try {
      await knex.transaction(async (trx: Knex.Transaction) => {
        await trx('tenant_extension_schedule')
          .where({ id, tenant_id: ctx.tenantId })
          .update(patch)

        await trx('tenant_extension_install')
          .where({ id: ctx.installId, tenant_id: ctx.tenantId })
          .update({ updated_at: trx.fn.now() })
      })
    } catch (error) {
      if (isNameUniqueViolation(error)) {
        return {
          success: false,
          error: 'Schedule name already in use for this extension',
          fieldErrors: { name: 'Schedule name already in use for this extension' },
        }
      }
      throw error
    }

    logger.info('Extension updated schedule via host API', {
      tenantId: ctx.tenantId,
      installId: ctx.installId,
      scheduleId: id,
    })

    success = true
    return { success: true }
  } catch (error: any) {
    logger.error('Failed to update schedule via host API', { ctx, scheduleId, input, error })
    if (error instanceof SchedulerInputError) {
      return { success: false, error: error.message, fieldErrors: { [error.field]: error.message } }
    }
    if (isNameUniqueViolation(error)) {
      return {
        success: false,
        error: 'Schedule name already in use for this extension',
        fieldErrors: { name: 'Schedule name already in use for this extension' },
      }
    }
    return { success: false, error: error?.message ?? 'Failed to update schedule' }
  } finally {
    recordMetric('update', ctx.tenantId, success, Date.now() - startTime)
  }
}

export async function deleteSchedule(
  ctx: InstallContext,
  scheduleId: string
): Promise<DeleteScheduleResult> {
  const startTime = Date.now()
  let success = false

  try {
    const knex = await getConnection(ctx.tenantId)
    const id = validateUuid(scheduleId, 'scheduleId')

    const current = await knex('tenant_extension_schedule')
      .where({ id, tenant_id: ctx.tenantId, install_id: ctx.installId })
      .first(['id', 'job_id'])

    if (!current) {
      return { success: false, error: 'Schedule not found' }
    }

    // Cancel job runner schedule
    if (current.job_id) {
      const runner = await getRunner()
      try {
        const cancelled = await runner.cancelJob(String(current.job_id), ctx.tenantId)
        if (!cancelled) {
          return { success: false, error: 'Failed to cancel runner schedule (not deleted)' }
        }
      } catch (e) {
        logger.warn('Failed to cancel schedule job during delete via host API', { ctx, scheduleId, error: e })
        return { success: false, error: 'Failed to cancel runner schedule (not deleted)' }
      }
    }

    // Delete from database
    await knex.transaction(async (trx: Knex.Transaction) => {
      await trx('tenant_extension_schedule')
        .where({ id, tenant_id: ctx.tenantId })
        .del()

      await trx('tenant_extension_install')
        .where({ id: ctx.installId, tenant_id: ctx.tenantId })
        .update({ updated_at: trx.fn.now() })
    })

    logger.info('Extension deleted schedule via host API', {
      tenantId: ctx.tenantId,
      installId: ctx.installId,
      scheduleId: id,
    })

    success = true
    return { success: true }
  } catch (error: any) {
    logger.error('Failed to delete schedule via host API', { ctx, scheduleId, error })
    if (error instanceof SchedulerInputError) {
      return { success: false, error: error.message }
    }
    return { success: false, error: error?.message ?? 'Failed to delete schedule' }
  } finally {
    recordMetric('delete', ctx.tenantId, success, Date.now() - startTime)
  }
}

export async function getEndpoints(ctx: InstallContext): Promise<EndpointInfo[]> {
  const startTime = Date.now()
  let success = false

  try {
    const knex = await getConnection(ctx.tenantId)

    const rows = await knex('extension_api_endpoint')
      .where({ version_id: ctx.versionId })
      .orderBy([{ column: 'path', order: 'asc' }])
      .select(['id', 'method', 'path', 'handler'])

    const result = rows.map((row: any) => {
      const method = String(row.method || '').toUpperCase()
      const path = String(row.path || '')
      const hasPathParams = path.includes('/:') || path.includes(':') || path.includes('{') || path.includes('}')
      const schedulable = ['GET', 'POST'].includes(method) && !hasPathParams

      return {
        id: row.id,
        method,
        path,
        handler: row.handler || '',
        schedulable,
      }
    })

    success = true
    return result
  } finally {
    recordMetric('getEndpoints', ctx.tenantId, success, Date.now() - startTime)
  }
}
