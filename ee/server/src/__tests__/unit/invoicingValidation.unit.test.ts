import { describe, expect, it } from 'vitest'

import { validateCreateManualInvoiceInput } from '@ee/lib/extensions/invoicingValidation'

describe('Invoicing validation (T012, T017)', () => {
  it('T012: rejects when items array is empty', () => {
    const result = validateCreateManualInvoiceInput({
      clientId: '8b7e8a8f-0b86-4e80-8a3f-1d7b1f9d9c08',
      items: [],
    })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.fieldErrors.items).toBeTruthy()
    }
  })

  it('T012: rejects when an item is missing required fields', () => {
    const result = validateCreateManualInvoiceInput({
      clientId: '8b7e8a8f-0b86-4e80-8a3f-1d7b1f9d9c08',
      items: [{ quantity: 1 }],
    })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.fieldErrors['items[0].serviceId']).toBeTruthy()
      expect(result.fieldErrors['items[0].description']).toBeTruthy()
      expect(result.fieldErrors['items[0].rate']).toBeTruthy()
    }
  })

  it('T017: rejects invalid invoiceDate/dueDate formats', () => {
    const result = validateCreateManualInvoiceInput({
      clientId: '8b7e8a8f-0b86-4e80-8a3f-1d7b1f9d9c08',
      invoiceDate: '2026/01/14',
      dueDate: '14-01-2026',
      items: [
        {
          serviceId: '8b7e8a8f-0b86-4e80-8a3f-1d7b1f9d9c08',
          quantity: 1,
          description: 'Item',
          rate: 100,
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.fieldErrors.invoiceDate).toBeTruthy()
      expect(result.fieldErrors.dueDate).toBeTruthy()
    }
  })
})

