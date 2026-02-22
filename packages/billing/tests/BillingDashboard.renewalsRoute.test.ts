import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/BillingDashboard.tsx', import.meta.url),
  'utf8'
);

describe('BillingDashboard renewals route removal', () => {
  it('does not register a standalone renewals route in the billing tab host', () => {
    expect(source).not.toContain('const [renewalsQueueRefreshTrigger, setRenewalsQueueRefreshTrigger] = useState(0);');
    expect(source).not.toContain('const handleRenewalsQueueMutationComplete = () => {');
    expect(source).not.toContain('setRenewalsQueueRefreshTrigger((current) => current + 1);');
    expect(source).not.toContain('<Tabs.Content value="renewals">');
    expect(source).not.toContain("import RenewalsQueueTab from './contracts/RenewalsQueueTab';");
    expect(source).not.toContain('<RenewalsQueueTab onQueueMutationComplete={handleRenewalsQueueMutationComplete} />');
    expect(source).toContain('<ClientContractsTab />');
  });
});
