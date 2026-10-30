import { describe, expect, it } from 'vitest';
import {
  baseInvoiceSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
} from '../../../lib/api/schemas/invoiceSchemas';
import { INVOICE_UPDATE_FIELDS, LIFECYCLE_OWNED_FIELDS } from '../../../lib/api/schemas/invoiceUpdateFields';

describe('invoice update field classification', () => {
  const createKeys = Object.keys(createInvoiceSchema.shape);
  const baseKeys = Object.keys(baseInvoiceSchema.shape);

  it('every lifecycle-owned field exists on the invoice schema (or is tenant)', () => {
    for (const field of LIFECYCLE_OWNED_FIELDS) {
      expect(
        field === 'tenant' || createKeys.includes(field) || baseKeys.includes(field),
        field,
      ).toBe(true);
    }
  });

  it('allowlist and lifecycle lists are disjoint and together cover every create-schema key', () => {
    const allowed: readonly string[] = INVOICE_UPDATE_FIELDS;
    const lifecycle: readonly string[] = LIFECYCLE_OWNED_FIELDS;
    expect(allowed.filter((f) => lifecycle.includes(f))).toEqual([]);
    const unclassified = [...createKeys, ...baseKeys].filter(
      (k) => !allowed.includes(k) && !lifecycle.includes(k),
    );
    expect(unclassified).toEqual([]);
  });

  it('updateInvoiceSchema accepts exactly the allowlist', () => {
    expect(Object.keys(updateInvoiceSchema.shape).sort()).toEqual([...INVOICE_UPDATE_FIELDS].sort());
  });
});
