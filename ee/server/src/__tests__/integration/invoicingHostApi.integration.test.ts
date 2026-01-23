import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Knex } from 'knex'
import path from 'node:path'
import { createRequire } from 'node:module'
import { v4 as uuidv4 } from 'uuid'

import { createTestDbConnection } from '@main-test-utils/dbConfig'

let db: Knex
let tenantId: string

const require = createRequire(import.meta.url)

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => db),
}))

vi.mock('@shared/db/admin', () => ({
  getAdminConnection: vi.fn(async () => db),
}))

describe('Invoicing Host API – internal endpoint + DB integration', () => {
  const HOOK_TIMEOUT = 180_000

  beforeAll(async () => {
    process.env.DB_PORT = process.env.DB_PORT || '5432'
    process.env.APP_ENV = process.env.APP_ENV || 'test'
    process.env.RUNNER_SERVICE_TOKEN = 'runner-test-token'

    db = await createTestDbConnection()
    await applyEeMigrationsForExtensionInstalls(db)
    tenantId = await ensureTenant(db)
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    await db?.destroy().catch(() => undefined)
  }, HOOK_TIMEOUT)

  beforeEach(async () => {
    // Best-effort cleanup for isolation (targeted to extension install artifacts).
    await db('tenant_extension_install').delete().catch(() => undefined)
    await db('extension_version').delete().catch(() => undefined)
    await db('extension_registry').delete().catch(() => undefined)
  }, HOOK_TIMEOUT)

  it('T008: rejects requests with missing/invalid x-runner-auth', async () => {
    const { handleInternalInvoicingInstallRequest } = await import('@ee/lib/extensions/invoicingInternalApi')

    const res1 = await handleInternalInvoicingInstallRequest({
      installId: uuidv4(),
      headers: new Headers(),
      body: { operation: 'createManualInvoice' },
    })
    expect(res1.status).toBe(401)

    const res2 = await handleInternalInvoicingInstallRequest({
      installId: uuidv4(),
      headers: new Headers({ 'x-runner-auth': 'wrong' }),
      body: { operation: 'createManualInvoice' },
    })
    expect(res2.status).toBe(401)
  })

  it('T009: returns NOT_FOUND for unknown installId', async () => {
    const { handleInternalInvoicingInstallRequest } = await import('@ee/lib/extensions/invoicingInternalApi')

    const res = await handleInternalInvoicingInstallRequest({
      installId: uuidv4(),
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: { operation: 'createManualInvoice' },
    })
    expect(res.status).toBe(404)
  })

  it('T010/T011/T015: createManualInvoice creates a draft manual invoice (capability-only) and returns stable success payload', async () => {
    const { handleInternalInvoicingInstallRequest } = await import('@ee/lib/extensions/invoicingInternalApi')

    const { installId } = await seedInstalledExtension(db, tenantId, {
      grantedCaps: ['cap:invoice.manual.create'],
      versionCaps: ['cap:invoice.manual.create'],
    })

    const clientId = uuidv4()
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Ext Invoice Client ${clientId.slice(0, 6)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })

    const { serviceId } = await seedService(db, tenantId)

    const res = await handleInternalInvoicingInstallRequest({
      installId,
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: {
        operation: 'createManualInvoice',
        clientId,
        items: [{ serviceId, quantity: 1, description: 'Manual item', rate: 10000 }],
      },
    })

    expect(res.status).toBe(201)
    expect(res.body?.success).toBe(true)
    expect(res.body?.invoice?.invoiceId).toBeTruthy()
    expect(res.body?.invoice?.invoiceNumber).toBeTruthy()
    expect(res.body?.invoice?.status).toBe('draft')
    expect(typeof res.body?.invoice?.subtotal).toBe('number')
    expect(typeof res.body?.invoice?.tax).toBe('number')
    expect(typeof res.body?.invoice?.total).toBe('number')

    const invoiceId = res.body.invoice.invoiceId as string
    const invoiceRow = await db('invoices')
      .where({ invoice_id: invoiceId, tenant: tenantId })
      .first(['invoice_id', 'status', 'is_manual'])
    expect(invoiceRow?.invoice_id).toBe(invoiceId)
    expect(invoiceRow?.status).toBe('draft')
    expect(Boolean((invoiceRow as any)?.is_manual)).toBe(true)
  })

  it('T013: rejects when clientId does not exist in tenant', async () => {
    const { handleInternalInvoicingInstallRequest } = await import('@ee/lib/extensions/invoicingInternalApi')

    const { installId } = await seedInstalledExtension(db, tenantId, {
      grantedCaps: ['cap:invoice.manual.create'],
      versionCaps: ['cap:invoice.manual.create'],
    })
    const { serviceId } = await seedService(db, tenantId)

    const res = await handleInternalInvoicingInstallRequest({
      installId,
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: {
        operation: 'createManualInvoice',
        clientId: uuidv4(),
        items: [{ serviceId, quantity: 1, description: 'Manual item', rate: 10000 }],
      },
    })
    expect(res.status).toBe(400)
    expect(res.body?.success).toBe(false)
    expect(String(res.body?.error || '')).toMatch(/client/i)
  })

  it('T014: rejects when serviceId does not exist in tenant', async () => {
    const { handleInternalInvoicingInstallRequest } = await import('@ee/lib/extensions/invoicingInternalApi')

    const { installId } = await seedInstalledExtension(db, tenantId, {
      grantedCaps: ['cap:invoice.manual.create'],
      versionCaps: ['cap:invoice.manual.create'],
    })

    const clientId = uuidv4()
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Ext Invoice Client ${clientId.slice(0, 6)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })

    const res = await handleInternalInvoicingInstallRequest({
      installId,
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: {
        operation: 'createManualInvoice',
        clientId,
        items: [{ serviceId: uuidv4(), quantity: 1, description: 'Manual item', rate: 10000 }],
      },
    })
    expect(res.status).toBe(400)
    expect(res.body?.success).toBe(false)
    expect(String(res.body?.error || '')).toMatch(/service/i)
  })

  it('T016: header fields invoiceDate/dueDate/poNumber persist on invoice record', async () => {
    const { handleInternalInvoicingInstallRequest } = await import('@ee/lib/extensions/invoicingInternalApi')

    const { installId } = await seedInstalledExtension(db, tenantId, {
      grantedCaps: ['cap:invoice.manual.create'],
      versionCaps: ['cap:invoice.manual.create'],
    })

    const clientId = uuidv4()
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: `Ext Invoice Client ${clientId.slice(0, 6)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    const { serviceId } = await seedService(db, tenantId)

    const invoiceDate = '2026-01-14'
    const dueDate = '2026-01-20'
    const poNumber = `PO-${uuidv4().slice(0, 8)}`

    const res = await handleInternalInvoicingInstallRequest({
      installId,
      headers: new Headers({ 'x-runner-auth': 'runner-test-token' }),
      body: {
        operation: 'createManualInvoice',
        clientId,
        invoiceDate,
        dueDate,
        poNumber,
        items: [{ serviceId, quantity: 2, description: 'Manual item', rate: 2500 }],
      },
    })
    expect(res.status).toBe(201)
    expect(res.body?.success).toBe(true)

    const invoiceId = res.body.invoice.invoiceId as string
    const row = await db('invoices')
      .where({ invoice_id: invoiceId, tenant: tenantId })
      .first(['invoice_date', 'due_date', 'po_number'])
    const storedInvoiceDate = row?.invoice_date ? new Date(row.invoice_date as any).toISOString().slice(0, 10) : null
    const storedDueDate = row?.due_date ? new Date(row.due_date as any).toISOString().slice(0, 10) : null
    expect(storedInvoiceDate).toBe(invoiceDate)
    expect(storedDueDate).toBe(dueDate)
    expect(row?.po_number).toBe(poNumber)
  })
})

async function ensureTenant(db: Knex): Promise<string> {
  const row = await db('tenants').first<{ tenant: string }>('tenant')
  if (row?.tenant) return row.tenant
  const id = uuidv4()
  await db('tenants').insert({
    tenant: id,
    client_name: `Test Co ${id.slice(0, 6)}`,
    email: `test-${id.slice(0, 6)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  })
  return id
}

async function seedService(db: Knex, tenant: string): Promise<{ serviceTypeId: string; serviceId: string }> {
  const serviceTypeId = uuidv4()
  await db('service_types').insert({
    id: serviceTypeId,
    tenant,
    name: `Ext Service Type ${serviceTypeId.slice(0, 6)}`,
    billing_method: 'fixed',
    order_number: Math.floor(Math.random() * 1000000),
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  })

  const serviceId = uuidv4()
  await db('service_catalog').insert({
    tenant,
    service_id: serviceId,
    service_name: `Ext Service ${serviceId.slice(0, 6)}`,
    description: 'Service for extension invoicing tests',
    default_rate: 10000,
    unit_of_measure: 'each',
    billing_method: 'fixed',
    custom_service_type_id: serviceTypeId,
    tax_rate_id: null,
    category_id: null,
  })

  return { serviceTypeId, serviceId }
}

async function seedInstalledExtension(
  db: Knex,
  tenantId: string,
  params: { grantedCaps: string[]; versionCaps: string[] }
): Promise<{ registryId: string; versionId: string; installId: string }> {
  const registryId = uuidv4()
  const versionId = uuidv4()
  const installId = uuidv4()

  await db('extension_registry').insert({
    id: registryId,
    publisher: 'vitest',
    name: `ext-${registryId.slice(0, 8)}`,
    display_name: 'Vitest Extension Invoicing',
    description: 'Vitest test extension',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  })

  await db('extension_version').insert({
    id: versionId,
    registry_id: registryId,
    version: '1.0.0',
    runtime: 'node',
    main_entry: 'index.js',
    api: JSON.stringify({}),
    ui: null,
    capabilities: JSON.stringify(params.versionCaps),
    api_endpoints: JSON.stringify([]),
    created_at: db.fn.now(),
  })

  await db('tenant_extension_install').insert({
    id: installId,
    tenant_id: tenantId,
    registry_id: registryId,
    version_id: versionId,
    granted_caps: JSON.stringify(params.grantedCaps),
    config: JSON.stringify({}),
    is_enabled: true,
    status: 'enabled',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  })

  return { registryId, versionId, installId }
}

async function applyEeMigrationsForExtensionInstalls(connection: Knex): Promise<void> {
  const eeMigrations = [
    '2025080801_create_extension_registry.cjs',
    '2025080802_create_extension_version.cjs',
    '2025080803_create_extension_bundle.cjs',
    '2025080804_create_tenant_extension_install.cjs',
    '20250810140000_align_registry_v2_schema.cjs',
    '20251031130000_create_install_config_tables.cjs',
  ]

  const repoRoot = path.resolve(process.cwd(), '..', '..')
  for (const name of eeMigrations) {
    const full = path.resolve(repoRoot, 'ee', 'server', 'migrations', name)
    const mod = require(full)
    await mod.up(connection)
  }
}
