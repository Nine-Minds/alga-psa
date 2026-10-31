import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../../../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('native ticket screens stay neutral: co-managed hunks are pinned to their gate', () => {
  it('/msp/tickets adds only the PSA-gated listCallout over the capability-gated strip', () => {
    const page = read('server/src/app/msp/tickets/page.tsx');
    const hits = page.split('\n').filter(line => /CoManaged/.test(line));
    expect(hits).toEqual([
      "import { CoManagedCalloutStrip } from '@/components/co-managed/CoManagedCalloutStrip';",
      expect.stringContaining("listCallout={productCode === 'psa' ? <CoManagedCalloutStrip /> : undefined}"),
    ]);
    const strip = read('server/src/components/co-managed/CoManagedCalloutStrip.tsx');
    expect(strip).toMatch(/<CoManagedFeatureBoundary mode="serves">\s*<CoManagedWorkSignalsProvider>/);
  });

  it('/msp/tickets/[id] has no co-managed screen branch beyond the existing workspace gate', () => {
    const page = read('server/src/app/msp/tickets/[id]/page.tsx');
    expect(page).not.toMatch(/CoManagedTicketSection|CoManagedCalloutStrip|SharedTicketScreen/);
  });

  it('the local provider adds appSection only when a session exists, via the L3a seam', () => {
    const provider = read('server/src/components/co-managed/CoManagedLocalTicketDataSourceProvider.tsx');
    expect(provider).toMatch(/slots:\s*\{[^}]*appSection/s);
    expect(provider).toContain("kind: 'local'");
  });

  it('the shared screen composes on composeTicketDataSource, not on msp-composition', () => {
    const screen = read('server/src/components/co-managed/SharedTicketScreen.tsx');
    expect(screen).toContain('composeTicketDataSource');
    expect(screen).toContain('appSection');
    expect(screen).not.toMatch(/msp-composition/);
  });

  it('the Customer Tickets route sits behind the serves boundary with an explanatory fallback', () => {
    const page = read('server/src/app/msp/tickets/customer/page.tsx');
    expect(page).toMatch(/<CoManagedFeatureBoundary mode="serves" fallback=\{<CustomerTicketsUnavailable \/>\}>/);
  });

  it('the CSV export builds rows from explicit fields and never mentions canHandBack', () => {
    const actions = read('server/src/lib/actions/coManagedTicketQueueActions.ts');
    const exp = actions.slice(actions.indexOf('exportCoManagedTicketQueueAction'), actions.indexOf('exportCoManagedTicketQueueAction') + 1500);
    expect(exp.split('bulkHandBackCoManagedTicketsAction')[0]).not.toMatch(/canHandBack/);
  });
});
