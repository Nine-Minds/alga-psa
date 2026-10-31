// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IQuoteDecisionSummary } from '@alga-psa/types';

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, opts: Record<string, string> & { defaultValue: string }) =>
      opts.defaultValue.replace(/\{\{(\w+)\}\}/g, (_m, k) => opts[k] ?? ''),
  }),
  useFormatters: () => ({ formatDate: (d: string) => `D(${d.slice(0, 10)})` }),
}));

import { QuoteDecisionLine, emailLinkDecisionForActivity, formatDecisionSigner } from './QuoteDecisionLine';

const base: IQuoteDecisionSummary = {
  decision_id: 'd1',
  decision: 'accepted',
  method: 'email_link',
  signer_name: 'Jane Doe',
  signer_email: 'jane@client.com',
  signer_title: null,
  decided_at: '2026-10-31T12:00:00.000Z',
};

afterEach(cleanup);

describe('QuoteDecisionLine', () => {
  it('renders "Accepted by Jane Doe (jane@client.com) via email link, <date>" for a contact signer', () => {
    render(<QuoteDecisionLine decision={base} />);
    expect(screen.getByTestId('quote-decision-line').textContent)
      .toBe('Accepted by Jane Doe (jane@client.com) via email link, D(2026-10-31)');
  });

  it('renders the rejected equivalent and the optional title', () => {
    render(<QuoteDecisionLine decision={{ ...base, decision: 'rejected', signer_title: 'CFO' }} />);
    expect(screen.getByTestId('quote-decision-line').textContent)
      .toBe('Rejected by Jane Doe (jane@client.com) via email link, D(2026-10-31) (CFO)');
  });

  it('formats a signer with only an email', () => {
    expect(formatDecisionSigner({ signer_name: null, signer_email: 'a@b.c' })).toBe('a@b.c');
  });

  it('pairs the Nth accepted activity with the Nth accepted decision, email-link only', () => {
    const later = { ...base, decision_id: 'd2', method: 'portal' as const, decided_at: '2026-11-02T00:00:00.000Z' };
    const activities = [
      { activity_id: 'a1', activity_type: 'accepted', created_at: '2026-10-31T12:00:00.100Z' },
      { activity_id: 'a2', activity_type: 'accepted', created_at: '2026-11-02T00:00:00.100Z' },
    ];
    expect(emailLinkDecisionForActivity([later, base], activities, activities[0])?.decision_id).toBe('d1');
    expect(emailLinkDecisionForActivity([later, base], activities, activities[1])).toBeNull();
  });
});
