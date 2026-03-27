/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('user management solo limit contract', () => {
  it('keeps the MSP create-user action disabled and shows upgrade copy for Solo tenants at the user cap', () => {
    const source = read('./UserManagement.tsx');

    expect(source).toContain("const { isSolo } = useTier();");
    expect(source).toContain("const soloMspUserLimitReached = portalType === 'msp' && isSolo && (licenseUsage?.used ?? 0) >= 1;");
    expect(source).toContain("disabled={portalType === 'msp' && soloMspUserLimitReached}");
    expect(source).toContain('Solo plan is limited to 1 user. Upgrade to Pro to add more users.');
  });
});
