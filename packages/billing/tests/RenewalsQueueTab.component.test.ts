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
    expect(source).toContain('Renewal queue table will appear here.');
  });
});
