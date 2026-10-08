import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The boundary logic is pure; keep the heavy ticket/asset UI (and their server actions) out of the test.
vi.mock('@alga-psa/assets/components/ClientAssetMultiSelect', () => ({ ClientAssetMultiSelect: () => null }));
vi.mock('@alga-psa/tickets/components/recurring/RecurringTicketsPage', () => ({ RecurringTicketsPage: () => null }));
vi.mock('@alga-psa/tickets/components/recurring/RecurringTicketEditor', () => ({ RecurringTicketEditor: () => null }));
vi.mock('@alga-psa/tickets/components/recurring/RecurringTicketsClientSection', () => ({ RecurringTicketsClientSection: () => null }));

import { buildRecurringTicketsCrossFeature } from '../MspRecurringTickets';

describe('recurring tickets product boundary (assets are PSA-only)', () => {
  it('supplies the asset picker for PSA', () => {
    expect(buildRecurringTicketsCrossFeature(false).renderAssetPicker).toBeTypeOf('function');
  });

  it('supplies no asset picker for AlgaDesk', () => {
    expect(buildRecurringTicketsCrossFeature(true).renderAssetPicker).toBeUndefined();
  });

  it('wires the AlgaDesk client provider to the AlgaDesk composition', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../clients/AlgaDeskClientCrossFeatureProvider.tsx'), 'utf8');
    expect(source).toContain('<MspRecurringTicketsClientSection clientId={props.clientId} isAlgaDeskMode />');
  });

  it('derives the mode from the tenant product on both recurring routes', () => {
    const routes = path.resolve(__dirname, '../../../../../server/src/app/msp/tickets/recurring');
    for (const file of ['page.tsx', '[definitionId]/page.tsx']) {
      const source = fs.readFileSync(path.join(routes, file), 'utf8');
      expect(source).toContain("getCurrentTenantProduct");
      expect(source).toContain("isAlgaDeskMode={productCode === 'algadesk'}");
    }
  });
});
