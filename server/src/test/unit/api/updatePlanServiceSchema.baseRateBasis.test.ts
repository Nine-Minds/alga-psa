import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { partialWithoutDefaults } from '@alga-psa/validation/lib/partialWithoutDefaults';
import {
  updatePlanServiceSchema,
  createPlanServiceFixedConfigSchema,
  createPlanServiceHourlyConfigSchema,
  createPlanServiceUsageConfigSchema,
  createPlanServiceBucketConfigSchema,
} from '../../../lib/api/schemas/contractLineSchemas';

// The schema as it was before base_rate_basis validation was added (3bca4d09); the
// default-free partial keeps the Zod 3 behaviour the comparison was written against.
const legacyUpdatePlanServiceSchema = z.object({
  quantity: z.number().min(0).optional(),
  custom_rate: z.number().min(0).optional(),
  type_config: z.union([
    partialWithoutDefaults(createPlanServiceFixedConfigSchema),
    partialWithoutDefaults(createPlanServiceHourlyConfigSchema),
    partialWithoutDefaults(createPlanServiceUsageConfigSchema),
    partialWithoutDefaults(createPlanServiceBucketConfigSchema),
  ]).optional(),
});

describe('updatePlanServiceSchema type_config.base_rate_basis', () => {
  it('rejects an unknown base_rate_basis instead of silently stripping it', () => {
    const result = updatePlanServiceSchema.safeParse({ type_config: { base_rate: 1000, base_rate_basis: 'shares' } });
    expect(result.success).toBe(false);
  });

  it.each(['share', 'per_unit'])('accepts base_rate_basis %s and preserves it', (basis) => {
    const result = updatePlanServiceSchema.safeParse({ type_config: { base_rate: 1000, base_rate_basis: basis } });
    expect(result.success).toBe(true);
    expect(result.success && result.data.type_config).toMatchObject({ base_rate: 1000, base_rate_basis: basis });
  });

  it('still accepts a type_config without base_rate_basis (including omitted base_rate)', () => {
    expect(updatePlanServiceSchema.safeParse({ type_config: {} }).success).toBe(true);
    expect(updatePlanServiceSchema.safeParse({ type_config: { hourly_rate: 5000 } }).success).toBe(true);
  });

  it('still strips unknown keys exactly as before', () => {
    const r = updatePlanServiceSchema.safeParse({ type_config: { hourly_rate: 5000, bogus: 1 } });
    // Pre-existing behaviour: the first (fixed, partial) union branch matches and strips
    // both keys. Asserted as equal to the pre-change schema's output.
    const before = legacyUpdatePlanServiceSchema.safeParse({ type_config: { hourly_rate: 5000, bogus: 1 } });
    expect(r.success && r.data.type_config).toEqual(before.success && before.data.type_config);
    expect(r.success && r.data.type_config).not.toHaveProperty('bogus');
  });

  it.each([
    { type_config: { enable_proration: true } },
    { type_config: { base_rate: 1000, pricing_basis: 'bogus' } },
    { type_config: { hourly_rate: 5000, bogus: 1 } },
    { type_config: {} },
    { type_config: { base_rate: 1000, base_rate_basis: 'share', extra: 1 } },
    { quantity: 2, custom_rate: 5 },
  ])('parses to the same output as the pre-change schema: %j', (input) => {
    const before = legacyUpdatePlanServiceSchema.safeParse(input);
    const after = updatePlanServiceSchema.safeParse(input);
    expect(after.success).toBe(before.success);
    expect(after.success && after.data).toEqual(before.success && before.data);
  });
});
