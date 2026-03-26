import { describe, expect, it } from 'vitest'

import { __testOnly } from '@ee/lib/extensions/clientReadService'

describe('clientReadService mapper', () => {
  it('T015: client mapper returns summary-safe fields only', () => {
    const mapped = __testOnly.mapClientSummary({
      client_id: '11111111-1111-4111-8111-111111111111',
      client_name: 'Acme',
      client_type: 'company',
      is_inactive: false,
      default_currency_code: 'USD',
      account_manager_id: null,
      account_manager_name: null,
      billing_email: 'billing@example.com',
      tenant: 'should-not-leak',
      secret_notes: 'should-not-leak',
    })

    expect(Object.keys(mapped).sort()).toEqual([
      'accountManagerId',
      'accountManagerName',
      'billingEmail',
      'clientId',
      'clientName',
      'clientType',
      'defaultCurrencyCode',
      'isInactive',
    ])
  })
})
