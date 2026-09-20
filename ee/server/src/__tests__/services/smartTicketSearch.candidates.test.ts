import { describe, expect, it } from 'vitest';

import {
  assembleCandidate,
  truncateAtBoundary,
} from '../../services/smartTicketSearch/loadSmartSearchCandidates';
import { approxTokens, charsForTokens } from '../../services/smartTicketSearch/smartSearchBudgets';

const row = (description: string | null = 'A plain description.') => ({
  ticket_id: 'tid',
  ticket_number: 'T-1',
  title: 'Printer offline',
  description,
  client_name: 'Acme',
});

const words = (n: number, word = 'lorem') => Array.from({ length: n }, () => word).join(' ');

describe('truncateAtBoundary', () => {
  it('returns short text untouched', () => {
    expect(truncateAtBoundary('short', 100)).toBe('short');
  });

  it('cuts at a sentence end when one is in the back half of the window', () => {
    const text = 'First sentence here. Second sentence follows. Third one is long and continues on.';
    const result = truncateAtBoundary(text, 50);
    expect(result).toBe('First sentence here. Second sentence follows. …');
    expect(result.length).toBeLessThanOrEqual(52);
  });

  it('falls back to a word boundary and never exceeds the window by more than the marker', () => {
    const text = words(40, 'abcdefgh');
    const result = truncateAtBoundary(text, 100);
    expect(result.endsWith(' …')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(102);
  });
});

describe('assembleCandidate budgeting', () => {
  it('keeps the newest comments and drops the oldest once the budget is spent', () => {
    // Title/number/client/description cost ~8 tokens; each comment ~30. Two fit, three do not.
    const budgets = { tokensPerTicket: 75, descriptionMaxTokens: 10 };
    const comments = [
      { author: 'client' as const, text: words(20) },      // newest
      { author: 'technician' as const, text: words(20) },
      { author: 'technician' as const, text: words(20) },  // oldest, does not fit
    ];
    const candidate = assembleCandidate(row('desc'), comments, budgets);
    expect(candidate.comments).toHaveLength(2);
    expect(candidate.comments[0].author).toBe('client');
    expect(candidate.approxTokens).toBeLessThanOrEqual(budgets.tokensPerTicket);
  });

  it('truncates the newest comment when even it does not fit, so the latest state always reaches the model', () => {
    const budgets = { tokensPerTicket: 40, descriptionMaxTokens: 10 };
    const candidate = assembleCandidate(row('desc'), [{ author: 'client', text: words(200) }], budgets);
    expect(candidate.comments).toHaveLength(1);
    expect(candidate.comments[0].text.endsWith('…')).toBe(true);
    expect(candidate.approxTokens).toBeLessThanOrEqual(budgets.tokensPerTicket + 1);
  });

  it('truncates the description before spending on comments', () => {
    const budgets = { tokensPerTicket: 3000, descriptionMaxTokens: 20 };
    const candidate = assembleCandidate(row(words(500)), [], budgets);
    expect(candidate.description.length).toBeLessThanOrEqual(charsForTokens(20) + 2);
    expect(approxTokens(candidate.description)).toBeLessThanOrEqual(21);
  });

  it('flattens markdown in the description and skips blank comments', () => {
    const candidate = assembleCandidate(row('# Heading\n\nSome **bold** text.'), [
      { author: 'technician', text: '   ' },
      { author: 'client', text: 'real' },
    ]);
    expect(candidate.description).not.toContain('#');
    expect(candidate.description).not.toContain('**');
    expect(candidate.comments).toEqual([{ author: 'client', text: 'real' }]);
  });

  it('falls back to the ticket number when the title is empty and tolerates a null description', () => {
    const candidate = assembleCandidate({ ...row(null), title: '' }, []);
    expect(candidate.title).toBe('T-1');
    expect(candidate.description).toBe('');
    expect(candidate.clientName).toBe('Acme');
  });
});
