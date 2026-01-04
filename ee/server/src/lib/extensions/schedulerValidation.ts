/**
 * Scheduler Validation Functions
 *
 * Pure validation functions for scheduler inputs. Separated from schedulerHostApi.ts
 * to allow unit testing without database dependencies.
 */

// Validation helpers - exported for testing

export class SchedulerInputError extends Error {
  field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = 'SchedulerInputError'
    this.field = field
  }
}

export function failField(field: string, message: string): never {
  throw new SchedulerInputError(field, message)
}

export function validateCronExpression(cron: string): string {
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

export function validatePayloadJson(payload: unknown): unknown {
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

export function validateTimezone(tz?: string): string {
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

export function validateUuid(id: string, fieldName: string): string {
  const v = String(id || '').trim()
  if (!v) throw new Error(`Missing ${fieldName}`)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) {
    failField(fieldName, `Invalid ${fieldName}`)
  }
  return v
}

export function validateScheduleName(name: unknown): string | null {
  if (name === null || name === undefined) return null
  const value = String(name).trim()
  if (!value) return null
  if (value.length > 128) {
    failField('name', 'Name too long')
  }
  return value
}
