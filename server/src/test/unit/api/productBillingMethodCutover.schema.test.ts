import { describe, expect, it } from 'vitest';
import {
  createProductSchema,
  updateProductSchema,
} from '../../../lib/api/schemas/productSchemas';

const validCreatePayload = {
  service_name: 'Managed Router',
  custom_service_type_id: '11111111-1111-4111-8111-111111111111',
  billing_method: 'usage' as const,
  default_rate: 10000,
  unit_of_measure: 'each',
};

describe('product billing_method cutover schema', () => {
  it('T012: rejects create payloads that submit legacy per_unit billing_method', () => {
    const result = createProductSchema.safeParse({
      ...validCreatePayload,
      billing_method: 'per_unit',
    });

    expect(result.success).toBe(false);
  });

  it('T012: rejects update payloads that submit legacy per_unit billing_method', () => {
    const result = updateProductSchema.safeParse({
      billing_method: 'per_unit',
    });

    expect(result.success).toBe(false);
  });

  it('T012: defaults product billing_method to canonical usage when omitted', () => {
    const result = createProductSchema.parse({
      ...validCreatePayload,
      billing_method: undefined,
    });

    expect(result.billing_method).toBe('usage');
  });
});
