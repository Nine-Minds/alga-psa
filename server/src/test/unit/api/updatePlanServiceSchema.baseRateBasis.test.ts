import { describe, expect, it } from 'vitest';
import { updatePlanServiceSchema } from '../../../lib/api/schemas/contractLineSchemas';

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
});
