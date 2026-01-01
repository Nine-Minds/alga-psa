'use server'

import crypto from 'node:crypto'
import { createTenantKnex } from '@/lib/db'
import type { Knex } from 'knex'
import logger from '@shared/core/logger'
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions'
import { hasPermission } from 'server/src/lib/auth/rbac'

import { getInstallConfig } from '../extensions/installConfig'
import { getJobRunnerInstance, initializeJobRunner } from 'server/src/lib/jobs/initializeJobRunner'

type ExtensionPermissionAction = 'read' | 'write'

export interface ExtensionScheduleListItem {
  id: string
  install_id: string
  tenant_id: string
  endpoint_id: string
  endpoint_method: string
  endpoint_path: string
  name?: string | null
  cron: string
  timezone: string
  enabled: boolean
  payload_json?: unknown
  job_id?: string | null
  runner_schedule_id?: string | null
  last_run_at?: string | null
  last_run_status?: string | null
  last_error?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface CreateExtensionScheduleInput {
  endpointId: string
  cron: string
  timezone?: string
  enabled?: boolean
  name?: string
  payloadJson?: unknown
}

export interface UpdateExtensionScheduleInput {
  endpointId?: string
  cron?: string
  timezone?: string
  enabled?: boolean
  name?: string | null
  payloadJson?: unknown | null
}

class ExtensionScheduleInputError extends Error {
  field: keyof CreateExtensionScheduleInput | keyof UpdateExtensionScheduleInput | 'scheduleId'

  constructor(field: ExtensionScheduleInputError['field'], message: string) {
    super(message)
    this.name = 'ExtensionScheduleInputError'
    this.field = field
  }
}

function failField(field: ExtensionScheduleInputError['field'], message: string): never {
  throw new ExtensionScheduleInputError(field, message)
}

async function ensureExtensionPermission(action: ExtensionPermissionAction): Promise<{ knex: Knex; tenantId: string }> {
  const user = await getCurrentUser()
  if (!user) throw new Error('User not authenticated')
  if (user.user_type === 'client') throw new Error('Insufficient permissions')

  const { knex, tenant } = await createTenantKnex()
  if (!tenant) throw new Error('Tenant not found')

  const allowed = await hasPermission(user, 'extension', action, knex)
  if (!allowed) throw new Error('Insufficient permissions')

  return { knex, tenantId: tenant }
}

function validateCronExpression(cron: string): string {
  const value = String(cron || '').trim()
  if (value.length > 128) {
    failField('cron', 'Cron expression too long')
  }
  const parts = value.split(/\s+/).filter(Boolean)
  // We only support standard 5-field cron for v1 (minute hour day-of-month month day-of-week).
  if (parts.length !== 5) {
    failField('cron', 'Invalid cron expression (expected 5 fields: m h dom mon dow)')
  }
  // Basic syntax guard: only allow digits, *, /, and comma in each field (no names yet).
  for (const part of parts) {
    if (!/^[0-9*/,-]+$/.test(part)) {
      failField('cron', 'Invalid cron expression (unsupported characters)')
    }
  }
  // Basic min-frequency guardrail: disallow every-minute schedules by default.
  // This is intentionally conservative; tune later if needed.
  const [min, hour, dom, mon, dow] = parts
  const allOtherStars = hour === '*' && dom === '*' && mon === '*' && dow === '*'
  if (allOtherStars) {
    // Matches: "* * * * *" or "*/1 * * * *" or "*/2 * * * *" etc.
    if (min === '*' || min === '*/1' || min === '*/2' || min === '*/3' || min === '*/4') {
      failField('cron', 'Cron too frequent (minimum interval is 5 minutes)')
    }
  }
  return value
}

function validatePayloadJson(payload: unknown): unknown {
  if (payload === null || payload === undefined) return null
  const json = JSON.stringify(payload)
  if (json.length > 100_000) {
    failField('payloadJson', 'Payload too large')
  }
  return payload
}

function validateTimezone(tz?: string): string {
  const value = String(tz || 'UTC').trim()
  if (!value) return 'UTC'
  if (value.length > 64) failField('timezone', 'Timezone too long')
  // Validate against IANA tz database via Intl (throws RangeError for unknown zones).
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date())
  } catch {
    failField('timezone', 'Invalid timezone')
  }
  return value
}

function validateUuid(id: string, fieldName: string): string {
  const v = String(id || '').trim()
  if (!v) throw new Error(`Missing ${fieldName}`)
  // Lightweight UUID shape check (accepts lower/upper).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) {
    if (fieldName === 'endpointId') failField('endpointId', 'Invalid endpointId')
    if (fieldName === 'scheduleId') failField('scheduleId', 'Invalid scheduleId')
    throw new Error(`Invalid ${fieldName}`)
  }
  return v
}

async function getRunner() {
  const existing = getJobRunnerInstance()
  if (existing) return existing
  return initializeJobRunner()
}

async function resolveInstallForTenant(knex: Knex, tenantId: string, extensionId: string) {
  const config = await getInstallConfig({ tenantId, extensionId })
  if (!config?.installId || !config.versionId) {
    return null
  }
  const install = await knex('tenant_extension_install')
    .where({ id: config.installId, tenant_id: tenantId })
    .first(['is_enabled'])
  return { ...config, isEnabled: install?.is_enabled !== false }
}

async function assertEndpointBelongsToVersion(trx: Knex, endpointId: string, versionId: string) {
  const row = await trx('extension_api_endpoint')
    .where({ id: endpointId, version_id: versionId })
    .first(['id', 'path', 'method'])
  if (!row) {
    failField('endpointId', 'Selected endpoint does not belong to the installed version')
  }
  const method = String((row as any).method || '').toUpperCase()
  if (!['GET', 'POST'].includes(method)) {
    failField('endpointId', 'Only GET and POST endpoints are schedulable in v1')
  }
  const path = String((row as any).path || '')
  if (path.includes('/:') || path.includes(':') || path.includes('{') || path.includes('}')) {
    failField('endpointId', 'Endpoints with path parameters are not schedulable in v1')
  }
}

function scheduleSingletonKey(installId: string, scheduleId: string): string {
  return `extsched:${installId}:${scheduleId}`
}

export async function listExtensionSchedules(extensionId: string): Promise<ExtensionScheduleListItem[]> {
  const { knex, tenantId: tenant } = await ensureExtensionPermission('read')

  const install = await resolveInstallForTenant(knex, tenant, extensionId)
  if (!install) return []

  const rows = await knex('tenant_extension_schedule as s')
    .join('extension_api_endpoint as e', 'e.id', 's.endpoint_id')
    .where({ 's.tenant_id': tenant, 's.install_id': install.installId })
    .orderBy([{ column: 's.created_at', order: 'asc' }])
    .select([
      's.id',
      's.install_id',
      's.tenant_id',
      's.endpoint_id',
      's.name',
      's.cron',
      's.timezone',
      's.enabled',
      's.payload_json',
      's.job_id',
      's.runner_schedule_id',
      's.last_run_at',
      's.last_run_status',
      's.last_error',
      's.created_at',
      's.updated_at',
      'e.method as endpoint_method',
      'e.path as endpoint_path',
    ])

  return rows.map((row: any) => ({
    ...row,
    last_run_at: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }))
}

export async function createExtensionSchedule(
  extensionId: string,
  input: CreateExtensionScheduleInput
): Promise<{ success: boolean; message?: string; scheduleId?: string; fieldErrors?: Record<string, string> }> {
  const { knex, tenantId: tenant } = await ensureExtensionPermission('write')

  const install = await resolveInstallForTenant(knex, tenant, extensionId)
  if (!install) return { success: false, message: 'Extension install not found' }

  const endpointId = validateUuid(input.endpointId, 'endpointId')
  const cron = validateCronExpression(input.cron)
  const timezone = validateTimezone(input.timezone)
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : true
  if (enabled && !install.isEnabled) {
    return { success: false, message: 'Extension is disabled; enable it before enabling schedules' }
  }
  const payloadJson = validatePayloadJson(input.payloadJson)

  const scheduleId = crypto.randomUUID()
  const now = knex.fn.now()

  try {
    // Guardrail: max schedules per install.
    const scheduleCountRow = await knex('tenant_extension_schedule')
      .where({ tenant_id: tenant, install_id: install.installId })
      .count<{ count: string }[]>({ count: '*' })
      .first()
    const count = Number((scheduleCountRow as any)?.count ?? 0)
    if (count >= 50) {
      return { success: false, message: 'Too many schedules (max 50 per extension install)' }
    }

    // First persist schedule configuration (DB-only).
    await knex.transaction(async (trx: Knex.Transaction) => {
      await assertEndpointBelongsToVersion(trx, endpointId, install.versionId)

      const row = {
        id: scheduleId,
        install_id: install.installId,
        tenant_id: tenant,
        endpoint_id: endpointId,
        name: input.name ? String(input.name).trim().slice(0, 128) : null,
        cron,
        timezone,
        enabled,
        payload_json: payloadJson ?? null,
        created_at: now,
        updated_at: now,
      }

      await trx('tenant_extension_schedule').insert(row)
    })

    // Then create durable runner schedule (outside SQL txn to avoid cross-connection deadlocks).
    if (enabled) {
      try {
        const runner = await getRunner()
        const { jobId, externalId } = await runner.scheduleRecurringJob(
          'extension-scheduled-invocation',
          { tenantId: tenant, installId: install.installId, scheduleId } as any,
          cron,
          { singletonKey: scheduleSingletonKey(install.installId, scheduleId), metadata: { kind: 'extension_schedule', scheduleId, timezone } }
        )
        await knex('tenant_extension_schedule')
          .where({ id: scheduleId, tenant_id: tenant })
          .update({
            job_id: jobId,
            runner_schedule_id: externalId,
            updated_at: knex.fn.now(),
          })
      } catch (e: any) {
        await knex('tenant_extension_schedule')
          .where({ id: scheduleId, tenant_id: tenant })
          .update({
            enabled: false,
            job_id: null,
            runner_schedule_id: null,
            last_error: `Failed to create runner schedule: ${e?.message ?? String(e)}`.slice(0, 4000),
            updated_at: knex.fn.now(),
          })
        return { success: false, message: e?.message ?? 'Failed to create runner schedule' }
      }
    }

    return { success: true, scheduleId }
  } catch (error: any) {
    logger.error('Failed to create extension schedule', { tenant, extensionId, error })
    if (error instanceof ExtensionScheduleInputError) {
      return { success: false, message: error.message, fieldErrors: { [error.field]: error.message } }
    }
    return { success: false, message: error?.message ?? 'Failed to create schedule' }
  }
}

export async function updateExtensionSchedule(
  extensionId: string,
  scheduleIdRaw: string,
  input: UpdateExtensionScheduleInput
): Promise<{ success: boolean; message?: string; fieldErrors?: Record<string, string> }> {
  const { knex, tenantId: tenant } = await ensureExtensionPermission('write')

  const install = await resolveInstallForTenant(knex, tenant, extensionId)
  if (!install) return { success: false, message: 'Extension install not found' }

  const scheduleId = validateUuid(scheduleIdRaw, 'scheduleId')
  const nextEndpointId = input.endpointId ? validateUuid(input.endpointId, 'endpointId') : undefined
  const nextCron = input.cron ? validateCronExpression(input.cron) : undefined
  const nextTimezone = input.timezone ? validateTimezone(input.timezone) : undefined
  const hasEnabledUpdate = typeof input.enabled === 'boolean'
  const payloadJson =
    'payloadJson' in input ? (input.payloadJson === null ? null : validatePayloadJson(input.payloadJson)) : undefined

  const now = knex.fn.now()

  try {
    const current = await knex('tenant_extension_schedule')
      .where({ id: scheduleId, tenant_id: tenant, install_id: install.installId })
      .first()

    if (!current) return { success: false, message: 'Schedule not found' }

    if (nextEndpointId) {
      await knex.transaction(async (trx: Knex.Transaction) => {
        await assertEndpointBelongsToVersion(trx, nextEndpointId, install.versionId)
      })
    }

    const patch: any = { updated_at: now }
    if (nextEndpointId) patch.endpoint_id = nextEndpointId
    if (nextCron) patch.cron = nextCron
    if (nextTimezone) patch.timezone = nextTimezone
    if ('name' in input) patch.name = input.name === null ? null : (input.name ? String(input.name).trim().slice(0, 128) : null)
    if ('payloadJson' in input) patch.payload_json = payloadJson
    if (hasEnabledUpdate) patch.enabled = Boolean(input.enabled)

    const needsReschedule =
      (nextCron && nextCron !== current.cron) ||
      (hasEnabledUpdate && Boolean(input.enabled) !== Boolean(current.enabled)) ||
      (nextTimezone && nextTimezone !== current.timezone)

    // Apply DB updates first (DB-only).
    await knex('tenant_extension_schedule')
      .where({ id: scheduleId, tenant_id: tenant })
      .update(patch)

    if (needsReschedule) {
      const runner = await getRunner()
      // Cancel existing recurring schedule if present.
      if (current.job_id) {
        try {
          await runner.cancelJob(String(current.job_id), tenant)
        } catch (e) {
          logger.warn('Failed to cancel existing schedule job', { scheduleId, tenant, error: e })
        }
      }

      const effectiveEnabled = hasEnabledUpdate ? Boolean(input.enabled) : Boolean(current.enabled)
      if (effectiveEnabled) {
        try {
          const cron = nextCron ?? String(current.cron)
          const tz = nextTimezone ?? String(current.timezone)
          const { jobId, externalId } = await runner.scheduleRecurringJob(
            'extension-scheduled-invocation',
            { tenantId: tenant, installId: install.installId, scheduleId } as any,
            cron,
            { singletonKey: scheduleSingletonKey(install.installId, scheduleId), metadata: { kind: 'extension_schedule', scheduleId, timezone: tz } }
          )
          await knex('tenant_extension_schedule')
            .where({ id: scheduleId, tenant_id: tenant })
            .update({ job_id: jobId, runner_schedule_id: externalId, updated_at: now })
        } catch (e: any) {
          await knex('tenant_extension_schedule')
            .where({ id: scheduleId, tenant_id: tenant })
            .update({
              enabled: false,
              job_id: null,
              runner_schedule_id: null,
              last_error: `Failed to reschedule: ${e?.message ?? String(e)}`.slice(0, 4000),
              updated_at: knex.fn.now(),
            })
          return { success: false, message: e?.message ?? 'Failed to reschedule' }
        }
      } else {
        await knex('tenant_extension_schedule')
          .where({ id: scheduleId, tenant_id: tenant })
          .update({ job_id: null, runner_schedule_id: null, updated_at: now })
      }
    }

    return { success: true }
  } catch (error: any) {
    logger.error('Failed to update extension schedule', { tenant, extensionId, scheduleId: scheduleIdRaw, error })
    if (error instanceof ExtensionScheduleInputError) {
      return { success: false, message: error.message, fieldErrors: { [error.field]: error.message } }
    }
    return { success: false, message: error?.message ?? 'Failed to update schedule' }
  }
}

export async function deleteExtensionSchedule(
  extensionId: string,
  scheduleIdRaw: string
): Promise<{ success: boolean; message?: string; fieldErrors?: Record<string, string> }> {
  const { knex, tenantId: tenant } = await ensureExtensionPermission('write')

  const install = await resolveInstallForTenant(knex, tenant, extensionId)
  if (!install) return { success: false, message: 'Extension install not found' }

  const scheduleId = validateUuid(scheduleIdRaw, 'scheduleId')

  try {
    const current = await knex('tenant_extension_schedule')
      .where({ id: scheduleId, tenant_id: tenant, install_id: install.installId })
      .first(['id', 'job_id'])
    if (!current) return { success: false, message: 'Schedule not found' }

    if (current.job_id) {
      const runner = await getRunner()
      try {
        await runner.cancelJob(String(current.job_id), tenant)
      } catch (e) {
        logger.warn('Failed to cancel schedule job during delete', { scheduleId, tenant, error: e })
      }
    }

    await knex.transaction(async (trx: Knex.Transaction) => {
      await trx('tenant_extension_schedule')
        .where({ id: scheduleId, tenant_id: tenant })
        .del()
      // Best-effort touch install updated_at to signal config change.
      await trx('tenant_extension_install')
        .where({ id: install.installId, tenant_id: tenant })
        .update({ updated_at: trx.fn.now() })
    })

    return { success: true }
  } catch (error: any) {
    logger.error('Failed to delete extension schedule', { tenant, extensionId, scheduleId: scheduleIdRaw, error })
    if (error instanceof ExtensionScheduleInputError) {
      return { success: false, message: error.message, fieldErrors: { [error.field]: error.message } }
    }
    return { success: false, message: error?.message ?? 'Failed to delete schedule' }
  }
}

export async function runExtensionScheduleNow(
  extensionId: string,
  scheduleIdRaw: string
): Promise<{ success: boolean; message?: string; fieldErrors?: Record<string, string> }> {
  const { knex, tenantId: tenant } = await ensureExtensionPermission('write')

  const install = await resolveInstallForTenant(knex, tenant, extensionId)
  if (!install) return { success: false, message: 'Extension install not found' }
  if (!install.isEnabled) return { success: false, message: 'Extension is disabled' }

  const scheduleId = validateUuid(scheduleIdRaw, 'scheduleId')

  try {
    const schedule = await knex('tenant_extension_schedule')
      .where({ id: scheduleId, tenant_id: tenant, install_id: install.installId })
      .first(['id', 'enabled'])
    if (!schedule) return { success: false, message: 'Schedule not found' }

    // Guardrail: rate limit run-now per tenant (5/minute).
    try {
      const since = new Date(Date.now() - 60_000)
      const rows = await knex('jobs')
        .where({ tenant, type: 'extension-scheduled-invocation' })
        .andWhere('created_at', '>=', since)
        .select(['metadata'])
      let runNowCount = 0
      for (const row of rows as any[]) {
        const meta = row?.metadata
        let obj: any = null
        try {
          obj = typeof meta === 'string' ? JSON.parse(meta) : meta
        } catch {}
        if (obj?.kind === 'extension_schedule_run_now') runNowCount += 1
      }
      if (runNowCount >= 5) {
        return { success: false, message: 'Run-now rate limit exceeded (try again later)' }
      }
    } catch (e) {
      // If jobs table query fails, do not block core action.
      console.warn('runExtensionScheduleNow: rate limit check failed', e)
    }

    const runner = await getRunner()
    const nowMinute = new Date()
    const keyMinute = `${nowMinute.getUTCFullYear()}${String(nowMinute.getUTCMonth() + 1).padStart(2, '0')}${String(nowMinute.getUTCDate()).padStart(2, '0')}${String(nowMinute.getUTCHours()).padStart(2, '0')}${String(nowMinute.getUTCMinutes()).padStart(2, '0')}`
    await runner.scheduleJob(
      'extension-scheduled-invocation',
      { tenantId: tenant, installId: install.installId, scheduleId } as any,
      { singletonKey: `extsched-run:${install.installId}:${scheduleId}:${keyMinute}`, metadata: { kind: 'extension_schedule_run_now', scheduleId } }
    )

    return { success: true }
  } catch (error: any) {
    logger.error('Failed to run extension schedule now', { tenant, extensionId, scheduleId: scheduleIdRaw, error })
    if (error instanceof ExtensionScheduleInputError) {
      return { success: false, message: error.message, fieldErrors: { [error.field]: error.message } }
    }
    return { success: false, message: error?.message ?? 'Failed to run schedule' }
  }
}
