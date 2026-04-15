import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('ContractLineService billing_cycle_alignment compatibility wiring', () => {
  it('T109 and T161: service fixed-config writes and copies derive legacy billing_cycle_alignment compatibly instead of requiring it from new payloads', () => {
    const source = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../../lib/api/services/ContractLineService.ts',
      ),
      'utf8',
    );

    expect(source).toContain("import { resolveBillingCycleAlignmentForCompatibility } from '@shared/billingClients/billingCycleAlignmentCompatibility';");
    expect(source.match(/resolveBillingCycleAlignmentForCompatibility\(/g)?.length).toBeGreaterThanOrEqual(5);
    expect(source).toContain('fallbackAlignment: existingConfig?.billing_cycle_alignment,');
    expect(source).not.toContain("billing_cycle_alignment: fixedConfig.billing_cycle_alignment ?? 'start'");
  });
});
