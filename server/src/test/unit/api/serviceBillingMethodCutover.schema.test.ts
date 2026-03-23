import { describe, expect, it } from 'vitest';
import {
  createServiceSchema,
  updateServiceSchema,
} from '../../../lib/api/schemas/serviceSchemas';

const validCreatePayload = {
  service_name: 'Managed Service',
  custom_service_type_id: '11111111-1111-4111-8111-111111111111',
  billing_method: 'fixed' as const,
  default_rate: 10000,
  unit_of_measure: 'hour',
};

describe('service billing_method cutover schema', () => {
  it('T002: rejects create payloads that submit legacy per_unit billing_method', () => {
    const result = createServiceSchema.safeParse({
      ...validCreatePayload,
      billing_method: 'per_unit',
    });

    expect(result.success).toBe(false);
  });

  it('T002: rejects update payloads that submit legacy per_unit billing_method', () => {
    const result = updateServiceSchema.safeParse({
      billing_method: 'per_unit',
    });

    expect(result.success).toBe(false);
  });
});
