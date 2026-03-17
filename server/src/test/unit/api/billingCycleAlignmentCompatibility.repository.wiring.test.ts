import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('billing_cycle_alignment repository compatibility wiring', () => {
  it('T109: template-clone repositories derive legacy billing_cycle_alignment through the compatibility helper', () => {
    const serverRepoSource = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../../lib/repositories/contractLineRepository.ts',
      ),
      'utf8',
    );
    const packageRepoSource = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../../../../packages/billing/src/repositories/contractLineRepository.ts',
      ),
      'utf8',
    );

    expect(serverRepoSource).toContain('resolveBillingCycleAlignmentForCompatibility({');
    expect(serverRepoSource).toContain('const templateBillingCycleAlignment =');
    expect(packageRepoSource).toContain('resolveBillingCycleAlignmentForCompatibility({');
    expect(packageRepoSource).toContain('const templateBillingCycleAlignment =');
  });
});
