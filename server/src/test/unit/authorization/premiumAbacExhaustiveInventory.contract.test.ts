import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const inventoryPath = path.resolve(
  __dirname,
  '../../../../../ee/docs/plans/2026-04-22-premium-abac-exhaustive-remediation-sweep/EXHAUSTIVE_SURFACE_INVENTORY.md'
);

const baselinePath = path.resolve(
  __dirname,
  '../../../../../ee/docs/plans/2026-04-21-premium-abac-authorization-kernel/CURRENT_AUTHORIZATION_BASELINE.md'
);

describe('premium ABAC exhaustive close-out artifacts', () => {
  const inventorySource = readFileSync(inventoryPath, 'utf8');
  const baselineSource = readFileSync(baselinePath, 'utf8');

  it('T025: inventory artifact maps reviewed surfaces to semantics, status, and validating tests/rationales', () => {
    expect(inventorySource).toContain('# Premium ABAC Exhaustive Surface Inventory');
    expect(inventorySource).toContain('## Surface Matrix');
    expect(inventorySource).toContain('| Domain | File / Surface | Chosen Semantics | Status | Validation |');
    expect(inventorySource).toContain('### F034 — Time / Delegation');
    expect(inventorySource).toContain('### F035 — Non-API Entry Points');
    expect(inventorySource).toContain('### F036 — CE/EE Helper Seams');
    expect(inventorySource).toContain('Lifecycle: `T001-T006`');
    expect(inventorySource).toContain('Quotes: `T007-T010`');
    expect(inventorySource).toContain('Documents: `T011-T014`');
    expect(inventorySource).toContain('Assets: `T015-T018`');
    expect(inventorySource).toContain('Projects: `T019-T023`');
    expect(inventorySource).toContain('Time/delegation re-audit: `T024`');
    expect(inventorySource).toContain('Close-out artifact contract: `T025`');
  });

  it('F038: baseline ledger cross-links the exhaustive sweep artifacts and implementation checkpoints', () => {
    expect(baselineSource).toContain('## Baseline Delta Cross-Links (2026-04-22 Exhaustive Sweep)');
    expect(baselineSource).toContain('ee/docs/plans/2026-04-22-premium-abac-exhaustive-remediation-sweep/EXHAUSTIVE_SURFACE_INVENTORY.md');
    expect(baselineSource).toContain('2507228e1');
    expect(baselineSource).toContain('33e72b1a2');
    expect(baselineSource).toContain('d57083f49');
  });
});
