import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const contractInfoBannerPath = path.resolve(
  process.cwd(),
  '../packages/scheduling/src/components/time-management/time-entry/time-sheet/ContractInfoBanner.tsx',
);
const usageTrackingPath = path.resolve(
  process.cwd(),
  '../packages/billing/src/components/billing-dashboard/UsageTracking.tsx',
);

describe('default-contract terminology copy contracts', () => {
  it('T011: time-entry banner copy uses system-managed default contract language and keeps unresolved explicit', () => {
    const source = fs.readFileSync(contractInfoBannerPath, 'utf8');

    expect(source).toContain('Time will be routed to the system-managed default contract.');
    expect(source).toContain("contractInfo.contractName || 'System-managed default contract'");
    expect(source).toContain('Multiple contract lines are eligible for this date. Select a contract line to persist assignment.');
  });

  it('T011: usage messaging mirrors system-managed default contract terminology', () => {
    const source = fs.readFileSync(usageTrackingPath, 'utf8');

    expect(source).toContain('Usage will route to the system-managed default contract.');
    expect(source).toContain('Using system-managed default contract');
  });
});
