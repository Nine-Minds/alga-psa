import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/RenewalsQueueTab.tsx', import.meta.url),
  'utf8'
);

describe('RenewalsQueueTab component', () => {
  it('exists as a standalone billing dashboard component', () => {
    expect(source).toContain('export default function RenewalsQueueTab()');
    expect(source).toContain('data-testid="renewals-queue-page"');
    expect(source).toContain('data-testid="renewals-queue-content"');
  });

  it('loads renewal queue rows from a server action on mount', () => {
    expect(source).toContain("listRenewalQueueRows,");
    expect(source).toContain('useEffect(() => {');
    expect(source).toContain('const result = await listRenewalQueueRows();');
    expect(source).toContain('setRows(result);');
    expect(source).toContain('Loading renewal queue...');
  });
});
