import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflowHelperSource = readFileSync(
  new URL('../../clients/src/lib/clientContractWorkflowEvents.ts', import.meta.url),
  'utf8'
);
const sharedClientContractSource = readFileSync(
  new URL('../../../shared/billingClients/clientContracts.ts', import.meta.url),
  'utf8'
);

describe('client contract workflow status wiring', () => {
  it('T020: uses assignment lifecycle status helpers instead of contract-header status fallbacks', () => {
    expect(workflowHelperSource).toContain("import { deriveClientContractStatus } from '@alga-psa/shared/billingClients';");
    expect(workflowHelperSource).toContain('return deriveClientContractStatus({');
    expect(sharedClientContractSource).not.toContain('const isInactiveByStatus =');
    expect(sharedClientContractSource).toContain('const shouldSkipForLifecycleState = isInactiveAssignment;');
  });
});
