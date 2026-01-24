import { describe, it, expect } from 'vitest';

import {
  CONTRACT_TAB_LABELS,
  CONTRACT_LABEL_TO_SUBTAB,
  CONTRACT_SUBTAB_LABELS,
  normalizeContractSubtab,
} from '../src/components/billing-dashboard/contracts/contractsTabs';

describe('contracts tabs config', () => {
  it('includes Templates, Client Contracts, Drafts (in order)', () => {
    expect(CONTRACT_TAB_LABELS).toEqual([
      CONTRACT_SUBTAB_LABELS.templates,
      CONTRACT_SUBTAB_LABELS['client-contracts'],
      CONTRACT_SUBTAB_LABELS.drafts,
    ]);
  });

  it('maps Drafts label to drafts subtab', () => {
    expect(CONTRACT_LABEL_TO_SUBTAB[CONTRACT_SUBTAB_LABELS.drafts]).toBe('drafts');
    expect(normalizeContractSubtab('drafts')).toBe('drafts');
  });
});
