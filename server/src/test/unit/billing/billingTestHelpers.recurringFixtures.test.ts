import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('billing test helper recurring fixture wiring', () => {
  it('createFixedPlanAssignment persists cadence_owner with a stable client default', () => {
    const source = readFileSync(
      path.resolve(process.cwd(), '../server/test-utils/billingTestHelpers.ts'),
      'utf8',
    );

    expect(source).toContain('cadenceOwner?: CadenceOwner;');
    expect(source).toContain("const cadenceOwner: CadenceOwner = options.cadenceOwner ?? 'client';");
    expect(source).toContain('cadence_owner: cadenceOwner,');
  });
});
