import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('ContractLineService cadence_owner compatibility wiring', () => {
  it('T108: service readers and touched writes normalize legacy cadence_owner values to client', () => {
    const source = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../../lib/api/services/ContractLineService.ts',
      ),
      'utf8',
    );

    expect(source).toContain('function normalizeContractLineCompatibility');
    expect(source.match(/normalizeContractLineCompatibility\(plan\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain(
      "updateData.cadence_owner = data.cadence_owner ?? resolveCadenceOwner(existingPlan.cadence_owner);",
    );
    expect(source).toContain(
      "updateData.cadence_owner = resolveCadenceOwner(plan.cadence_owner);",
    );
  });
});
