import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tenantDb } from '@alga-psa/db'
import type { Knex } from 'knex'
import { v4 as uuidv4 } from 'uuid'

import { createTestDbConnection } from '@main-test-utils/dbConfig'
import { insertTestServiceType } from '@main-test-utils/serviceTypeFixtures'

let db: Knex
let tenantId: string

describe('insertTestServiceType', () => {
  const HOOK_TIMEOUT = 180_000

  beforeAll(async () => {
    db = await createTestDbConnection()
    tenantId = uuidv4()
    await tenantDb(db, tenantId).table('tenants').insert({
      tenant: tenantId,
      client_name: `Service Type Fixture ${tenantId.slice(0, 6)}`,
      email: `service-type-${tenantId.slice(0, 6)}@example.com`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
  }, HOOK_TIMEOUT)

  afterAll(async () => {
    if (db && tenantId) {
      await tenantDb(db, tenantId).table('service_types').delete().catch(() => undefined)
      await tenantDb(db, tenantId).table('tenants').delete().catch(() => undefined)
    }
    await db?.destroy().catch(() => undefined)
  }, HOOK_TIMEOUT)

  it('takes the next free order_number after rows other writers already placed', async () => {
    await tenantDb(db, tenantId).table('service_types').insert({
      id: uuidv4(),
      tenant: tenantId,
      name: 'Existing high-order type',
      order_number: 41,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    })

    const { orderNumber } = await insertTestServiceType(db, tenantId, { name: 'After existing' })

    expect(orderNumber).toBe(42)
  })

  it('gives concurrent writers on one tenant distinct order numbers instead of a unique-constraint failure', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => insertTestServiceType(db, tenantId, { name: `Concurrent ${i}` }))
    )

    const stored = await tenantDb(db, tenantId)
      .table('service_types')
      .whereIn('id', results.map((r) => r.serviceTypeId))
      .pluck('order_number')

    expect(stored).toHaveLength(8)
    expect(new Set(stored.map(Number)).size).toBe(8)
    expect(new Set(results.map((r) => r.orderNumber)).size).toBe(8)
  })
})
