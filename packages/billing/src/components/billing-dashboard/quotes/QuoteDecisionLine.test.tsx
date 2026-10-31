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

  it('links an activity to its decision by metadata.decision_id; legacy activities with no decision render nothing special', () => {
    const portal = { ...base, decision_id: 'd2', method: 'portal' as const };
    const legacy = { activity_id: 'a0', activity_type: 'accepted', metadata: {} };
    const emailLink = { activity_id: 'a1', activity_type: 'accepted', metadata: { decision_id: 'd1' } };
    const portalActivity = { activity_id: 'a2', activity_type: 'accepted', metadata: { decision_id: 'd2' } };
    const dangling = { activity_id: 'a3', activity_type: 'accepted', metadata: { decision_id: 'gone' } };
    const decisions = [portal, base];
    expect(emailLinkDecisionForActivity(decisions, legacy)).toBeNull();
    expect(emailLinkDecisionForActivity(decisions, emailLink)?.decision_id).toBe('d1');
    expect(emailLinkDecisionForActivity(decisions, portalActivity)).toBeNull();
    expect(emailLinkDecisionForActivity(decisions, dangling)).toBeNull();
    expect(emailLinkDecisionForActivity(decisions, { activity_type: 'sent', metadata: { decision_id: 'd1' } })).toBeNull();
  });

  it('activity log: an older legacy accepted activity beside an email-link one — only the latter renders the signer line', () => {
    const activities = [
      { activity_id: 'old', activity_type: 'accepted', description: 'Legacy accepted', metadata: {} },
      { activity_id: 'new', activity_type: 'accepted', description: 'Quote accepted via email link', metadata: { decision_id: 'd1' } },
    ];
    render(
      <ul>
        {activities.map((a) => {
          const linked = emailLinkDecisionForActivity([base], a);
          return <li key={a.activity_id} data-testid={a.activity_id}>{linked ? <QuoteDecisionLine decision={linked} /> : a.description}</li>;
        })}
      </ul>,
    );
    expect(screen.getByTestId('old').textContent).toBe('Legacy accepted');
    expect(screen.getByTestId('old').querySelector('[data-testid="quote-decision-line"]')).toBeNull();
    expect(screen.getByTestId('new').textContent).toBe('Accepted by Jane Doe (jane@client.com) via email link, D(2026-10-31)');
  });
});
