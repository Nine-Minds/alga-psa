/**
 * Invoicing Host API for Extensions (Manual Invoice MVP)
 *
 * Internal API for extensions to create draft manual invoices via the
 * cap:invoice.manual.create capability. These functions are called by the Runner
 * on behalf of extensions and are scoped to the calling extension's install.
 */

import { Temporal } from '@js-temporal/polyfill'
import type { Knex } from 'knex'
import { v4 as uuidv4 } from 'uuid'

import { getConnection } from '@/lib/db/db'

import { TaxService } from 'server/src/lib/services/taxService'
import { NumberingService } from 'server/src/lib/services/numberingService'
import {
  calculateAndDistributeTax,
  getClientDetails,
  persistManualInvoiceCharges,
  updateInvoiceTotalsAndRecordTransaction,
} from 'server/src/lib/services/invoiceService'

export interface ManualInvoiceItemInput {
  serviceId: string
  quantity: number
  description: string
  rate: number
  isDiscount?: boolean
  discountType?: 'percentage' | 'fixed'
  appliesToItemId?: string
  appliesToServiceId?: string
}

export interface CreateManualInvoiceInput {
  clientId: string
  items: ManualInvoiceItemInput[]
  invoiceDate?: string
  dueDate?: string
  poNumber?: string | null
}

export type CreateManualInvoiceResult =
  | {
      success: true
      invoice: {
        invoiceId: string
        invoiceNumber: string
        status: string
        subtotal: number
        tax: number
        total: number
      }
    }
  | { success: false; error: string; fieldErrors?: Record<string, string> }

export interface InstallContext {
  tenantId: string
  installId: string
  versionId: string
  registryId: string
}

async function resolveAttributionUserId(trx: Knex.Transaction, tenantId: string): Promise<string> {
  const user = await trx('users').where({ tenant: tenantId }).first<{ user_id: string }>('user_id')
  if (!user?.user_id) {
    throw new Error('No user found for tenant (required for invoice attribution)')
  }
  return user.user_id
}

function todayIsoDate(): string {
  return Temporal.Now.plainDateISO().toString()
}

export async function createManualInvoice(
  ctx: InstallContext,
  input: CreateManualInvoiceInput
): Promise<CreateManualInvoiceResult> {
  const knex = await getConnection(ctx.tenantId)
  const taxService = new TaxService()
  const numberingService = new NumberingService()

  try {
    const invoiceId = uuidv4()

    const invoiceDate = input.invoiceDate ?? todayIsoDate()
    const dueDate = input.dueDate ?? invoiceDate

    const invoiceNumber = await numberingService.getNextNumber('INVOICE')

    const result = await knex.transaction(async (trx) => {
      const createdByUserId = await resolveAttributionUserId(trx, ctx.tenantId)
      const sessionLike = { user: { id: createdByUserId } } as any

      const client = await getClientDetails(trx, ctx.tenantId, input.clientId)

      await trx('invoices').insert({
        invoice_id: invoiceId,
        tenant: ctx.tenantId,
        client_id: input.clientId,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        po_number: input.poNumber ?? null,
        status: 'draft',
        subtotal: 0,
        tax: 0,
        total_amount: 0,
        credit_applied: 0,
        is_manual: true,
        is_prepayment: false,
      })

      await persistManualInvoiceCharges(
        trx,
        invoiceId,
        input.items.map((item) => ({
          service_id: item.serviceId,
          quantity: item.quantity,
          description: item.description,
          rate: Math.round(item.rate),
          is_discount: Boolean(item.isDiscount),
          discount_type: item.discountType,
          applies_to_item_id: item.appliesToItemId,
          applies_to_service_id: item.appliesToServiceId,
        })),
        client,
        sessionLike,
        ctx.tenantId
      )

      await calculateAndDistributeTax(trx, invoiceId, client, taxService, ctx.tenantId)

      await updateInvoiceTotalsAndRecordTransaction(trx, invoiceId, client, ctx.tenantId, invoiceNumber, undefined, {
        transactionType: 'invoice_generated',
        description: `Generated manual invoice ${invoiceNumber} (extension install ${ctx.installId})`,
      })

      const invoiceRow = await trx('invoices')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .first(['invoice_id', 'invoice_number', 'status', 'subtotal', 'tax', 'total_amount'])

      if (!invoiceRow) {
        throw new Error('Failed to load created invoice record')
      }

      return {
        invoiceId: invoiceRow.invoice_id as string,
        invoiceNumber: invoiceRow.invoice_number as string,
        status: String(invoiceRow.status),
        subtotal: Number(invoiceRow.subtotal ?? 0),
        tax: Number(invoiceRow.tax ?? 0),
        total: Number(invoiceRow.total_amount ?? 0),
      }
    })

    return { success: true, invoice: result }
  } catch (error: any) {
    const message = error?.message ? String(error.message) : 'Internal error'

    // Best-effort domain mapping for stable errors
    if (/client not found/i.test(message)) {
      return { success: false, error: 'Client not found', fieldErrors: { clientId: 'Client not found' } }
    }
    if (/service not found/i.test(message)) {
      return { success: false, error: 'Service not found', fieldErrors: { serviceId: 'Service not found' } }
    }

    return { success: false, error: message }
  }
}

