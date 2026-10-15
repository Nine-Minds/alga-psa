import { describe, expect, it } from 'vitest';

import { approxTokens, charsForTokens } from '../../services/smartSearch/budgets';
import { assembleCandidate, normalizeRichText, toIso, truncateAtBoundary } from '../../services/smartSearch/candidate';

const words = (n: number, word = 'lorem') => Array.from({ length: n }, () => word).join(' ');

const head = { number: 'T-1', title: 'Printer offline', status: 'Open', is_closed: false, due_date: null };

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

describe('normalizeRichText and toIso', () => {
  it('flattens markdown and BlockNote JSON to plain text and tolerates blanks', () => {
    expect(normalizeRichText('# Heading\n\nSome **bold** text.')).not.toMatch(/[#*]/);
    expect(normalizeRichText('   ')).toBe('');
    expect(normalizeRichText(null)).toBe('');
    expect(normalizeRichText('[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]')).toContain('hello');
  });

  it('renders dates as ISO strings and unparseable values as null', () => {
    expect(toIso(new Date('2026-09-01T10:00:00Z'))).toBe('2026-09-01T10:00:00.000Z');
    expect(toIso('2026-09-02T10:00:00.000Z')).toBe('2026-09-02T10:00:00.000Z');
    expect(toIso('not a date')).toBeNull();
    expect(toIso(null)).toBeNull();
    expect(toIso('')).toBeNull();
  });
});

describe('assembleCandidate budgeting', () => {
  it('puts the head first, then the description, then each section under its key', () => {
    const candidate = assembleCandidate({
      id: 'c1',
      head,
      description: 'desc',
      sections: [{ key: 'comments', items: [{ author: 'client', text: 'newest' }] }],
    });
    expect(Object.keys(candidate.state)).toEqual(['number', 'title', 'status', 'is_closed', 'due_date', 'description', 'comments']);
    expect(candidate.state.comments).toEqual([{ author: 'client', text: 'newest' }]);
    expect(JSON.stringify(candidate.state)).not.toContain('c1');
    expect(candidate.approxTokens).toBeGreaterThan(approxTokens(JSON.stringify(head)));
  });

  it('keeps the newest children and drops the oldest once the budget is spent', () => {
    // Head + description cost ~22 tokens, each comment ~38. Two fit in 110, three do not.
    const budgets = { tokensPerCandidate: 110, descriptionMaxTokens: 10 };
    const items = [
      { author: 'client', text: words(20) }, // newest
      { author: 'technician', text: words(20) },
      { author: 'technician', text: words(20) }, // oldest, does not fit
    ];
    const candidate = assembleCandidate({ id: 'c1', head, description: 'desc', sections: [{ key: 'comments', items }] }, budgets);
    expect(candidate.state.comments).toHaveLength(2);
    expect((candidate.state.comments as Array<{ author: string }>)[0].author).toBe('client');
    expect(candidate.approxTokens).toBeLessThanOrEqual(budgets.tokensPerCandidate);
  });

  it('truncates the newest child when even it does not fit, so the latest state always reaches the model', () => {
    const budgets = { tokensPerCandidate: 100, descriptionMaxTokens: 10 };
    const candidate = assembleCandidate(
      { id: 'c1', head, description: 'desc', sections: [{ key: 'comments', items: [{ author: 'client', text: words(200) }] }] },
      budgets
    );
    const comments = candidate.state.comments as Array<{ text: string }>;
    expect(comments).toHaveLength(1);
    expect(comments[0].text.endsWith('…')).toBe(true);
    expect(candidate.approxTokens).toBeLessThanOrEqual(budgets.tokensPerCandidate + 1);
  });

  it('fills sections in order: an earlier section takes budget before a later one, and a later one gets no sliver', () => {
    // Head + description ~22 tokens, each task ~35: two tasks leave ~8 tokens, not enough for a comment.
    const budgets = { tokensPerCandidate: 100, descriptionMaxTokens: 10 };
    const candidate = assembleCandidate(
      {
        id: 'c1',
        head,
        description: 'desc',
        sections: [
          { key: 'tasks', items: [{ task: 'a', text: words(20) }, { task: 'b', text: words(20) }] },
          { key: 'comments', items: [{ author: 'client', text: words(20) }] },
        ],
      },
      budgets
    );
    expect(candidate.state.tasks).toHaveLength(2);
    expect(candidate.state.comments).toHaveLength(0);
  });

  it('truncates the description before spending on children', () => {
    const budgets = { tokensPerCandidate: 3000, descriptionMaxTokens: 20 };
    const candidate = assembleCandidate({ id: 'c1', head, description: words(500), sections: [] }, budgets);
    const description = candidate.state.description as string;
    expect(description.length).toBeLessThanOrEqual(charsForTokens(20) + 2);
    expect(approxTokens(description)).toBeLessThanOrEqual(21);
  });

  it('flattens markdown in the description', () => {
    const candidate = assembleCandidate({ id: 'c1', head, description: '# Heading\n\nSome **bold** text.', sections: [] });
    expect(candidate.state.description).not.toContain('#');
    expect(candidate.state.description).not.toContain('**');
  });
});
