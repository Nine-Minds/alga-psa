/**
 * Invoicing Validation Functions
 *
 * Pure validation helpers for host invoicing inputs. Keeps input validation
 * unit-testable without DB dependencies.
 */

import type { CreateManualInvoiceInput, ManualInvoiceItemInput } from './invoicingHostApi'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return String(value).trim()
}

function addError(map: Record<string, string>, field: string, message: string): void {
  if (!map[field]) map[field] = message
}

function validateUuid(value: unknown, field: string, errors: Record<string, string>): string | undefined {
  const v = asTrimmedString(value)
  if (!v) {
    addError(errors, field, 'Required')
    return undefined
  }
  if (!UUID_RE.test(v)) {
    addError(errors, field, 'Invalid UUID')
    return undefined
  }
  return v
}

function validateIsoDate(value: unknown, field: string, errors: Record<string, string>): string | undefined {
  const v = asTrimmedString(value)
  if (!v) return undefined
  if (!ISO_DATE_RE.test(v)) {
    addError(errors, field, 'Invalid date (expected YYYY-MM-DD)')
    return undefined
  }
  return v
}

function validateItems(items: unknown, errors: Record<string, string>): ManualInvoiceItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    addError(errors, 'items', 'Must include at least one item')
    return []
  }

  const result: ManualInvoiceItemInput[] = []

  items.forEach((raw, idx) => {
    if (!isRecord(raw)) {
      addError(errors, `items[${idx}]`, 'Invalid item')
      return
    }

    const serviceId = validateUuid(raw.serviceId, `items[${idx}].serviceId`, errors)
    const description = asTrimmedString(raw.description)
    if (!description) addError(errors, `items[${idx}].description`, 'Required')
    if (description && description.length > 500) addError(errors, `items[${idx}].description`, 'Too long')

    const quantity = Number(raw.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      addError(errors, `items[${idx}].quantity`, 'Must be > 0')
    }

    const rate = Number(raw.rate)
    if (!Number.isFinite(rate) || rate < 0) {
      addError(errors, `items[${idx}].rate`, 'Must be >= 0')
    }

    const isDiscount = raw.isDiscount === undefined ? undefined : Boolean(raw.isDiscount)
    const discountTypeRaw = asTrimmedString(raw.discountType)
    const discountType =
      discountTypeRaw === 'percentage' || discountTypeRaw === 'fixed'
        ? (discountTypeRaw as 'percentage' | 'fixed')
        : undefined

    if (isDiscount) {
      if (!discountType) {
        addError(errors, `items[${idx}].discountType`, 'Required when isDiscount=true')
      }
      if (discountType === 'percentage' && Number.isFinite(rate) && (rate < 0 || rate > 100)) {
        addError(errors, `items[${idx}].rate`, 'Percentage discount rate must be between 0 and 100')
      }
    } else {
      if (discountTypeRaw) {
        addError(errors, `items[${idx}].discountType`, 'Not allowed unless isDiscount=true')
      }
      if (raw.appliesToItemId !== undefined || raw.appliesToServiceId !== undefined) {
        addError(errors, `items[${idx}]`, 'appliesTo* fields require isDiscount=true')
      }
    }

    const appliesToItemId =
      raw.appliesToItemId === undefined
        ? undefined
        : validateUuid(raw.appliesToItemId, `items[${idx}].appliesToItemId`, errors)
    const appliesToServiceId =
      raw.appliesToServiceId === undefined
        ? undefined
        : validateUuid(raw.appliesToServiceId, `items[${idx}].appliesToServiceId`, errors)

    if (appliesToItemId && appliesToServiceId) {
      addError(errors, `items[${idx}]`, 'Provide only one of appliesToItemId or appliesToServiceId')
    }

    if (serviceId && description && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(rate) && rate >= 0) {
      result.push({
        serviceId,
        quantity,
        description,
        rate,
        isDiscount,
        discountType,
        appliesToItemId,
        appliesToServiceId,
      })
    }
  })

  return result
}

export function validateCreateManualInvoiceInput(
  raw: unknown
): { ok: true; value: CreateManualInvoiceInput } | { ok: false; error: string; fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {}

  if (!isRecord(raw)) {
    return { ok: false, error: 'Invalid request body', fieldErrors: { body: 'Expected JSON object' } }
  }

  const clientId = validateUuid(raw.clientId, 'clientId', errors)
  const items = validateItems(raw.items, errors)
  const invoiceDate = validateIsoDate(raw.invoiceDate, 'invoiceDate', errors)
  const dueDate = validateIsoDate(raw.dueDate, 'dueDate', errors)

  const poNumberRaw = raw.poNumber === null ? null : asTrimmedString(raw.poNumber)
  const poNumber = poNumberRaw === null ? null : poNumberRaw || undefined
  if (typeof poNumber === 'string' && poNumber.length > 128) {
    addError(errors, 'poNumber', 'Too long')
  }

  if (Object.keys(errors).length > 0 || !clientId) {
    return { ok: false, error: 'Validation error', fieldErrors: errors }
  }

  return {
    ok: true,
    value: {
      clientId,
      items,
      invoiceDate,
      dueDate,
      poNumber,
    },
  }
}

