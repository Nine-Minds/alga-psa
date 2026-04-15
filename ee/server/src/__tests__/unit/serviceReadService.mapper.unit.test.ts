import { describe, expect, it } from 'vitest'

import { __testOnly } from '@ee/lib/extensions/serviceReadService'

describe('serviceReadService mapper', () => {
  it('T016: service mapper returns summary-safe fields only', () => {
    const mapped = __testOnly.mapServiceSummary({
      service_id: '11111111-1111-4111-8111-111111111111',
      service_name: 'Managed Monitoring',
      item_kind: 'service',
      billing_method: 'fixed',
      custom_service_type_id: '22222222-2222-4222-8222-222222222222',
      service_type_name: 'Managed',
      default_rate: 150,
      unit_of_measure: 'month',
      is_active: true,
      sku: 'MON-001',
      tenant: 'should-not-leak',
      internal_margin: 0.42,
    })

    expect(Object.keys(mapped).sort()).toEqual([
      'billingMethod',
      'defaultRate',
      'isActive',
      'itemKind',
      'serviceId',
      'serviceName',
      'serviceTypeId',
      'serviceTypeName',
      'sku',
      'unitOfMeasure',
    ])
  })
})
