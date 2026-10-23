import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboardSource = readFileSync(
  new URL('../../src/components/billing-dashboard/BillingDashboard.tsx', import.meta.url),
  'utf8',
);
const quotesTabSource = readFileSync(
  new URL('../../src/components/billing-dashboard/quotes/QuotesTab.tsx', import.meta.url),
  'utf8',
);

describe('quote template deep-link parameter contract', () => {
  it('T010: BillingDashboard emits the same source template param QuotesTab consumes', () => {
    // Producer: the "Create Quote from Template" row action must use the
    // renamed param, not the old, overloaded `templateId`.
    expect(dashboardSource).toContain('quoteId=new&sourceTemplateId=');
    expect(dashboardSource).not.toContain('quoteId=new&templateId=');

    // Consumer: QuotesTab must read that exact name. If either side drifts, the
    // template id is silently dropped again and the original bug returns.
    expect(quotesTabSource).toContain("searchParams?.get('sourceTemplateId')");
  });
});
