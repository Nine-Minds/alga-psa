import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_TEXT_LENGTH,
  MAX_REGEX_PATTERN_LENGTH,
  buildRuleEmailInput,
  evaluateCondition,
  evaluateConditions,
  extractValue,
  extractionToRegexSource,
  normalizeExtractedValue,
} from '../inboundEmailRules/evaluator';
import type {
  InboundEmailRuleCondition,
  InboundEmailRuleEmailInput,
} from '../inboundEmailRules/types';

function makeInput(overrides: Partial<InboundEmailRuleEmailInput> = {}): InboundEmailRuleEmailInput {
  return {
    fromAddress: 'alerts@huntress.com',
    fromDomain: 'huntress.com',
    toAddresses: ['support@msp.com'],
    subject: 'Critical Alert (Acme Corp) - EDR detection',
    bodyText: 'Incident details follow.',
    ...overrides,
  };
}

function condition(partial: Partial<InboundEmailRuleCondition>): InboundEmailRuleCondition {
  return {
    field: 'subject',
    operator: 'contains',
    value: '',
    ...partial,
  };
}

describe('inboundEmailRules evaluator: conditions', () => {
  it('equals matches case-insensitively', () => {
    const input = makeInput({ subject: 'Status Update' });
    expect(
      evaluateCondition(condition({ operator: 'equals', value: 'status update' }), input)
    ).toBe(true);
    expect(
      evaluateCondition(condition({ operator: 'equals', value: 'status' }), input)
    ).toBe(false);
  });

  it('contains matches substring case-insensitively', () => {
    const input = makeInput();
    expect(
      evaluateCondition(condition({ operator: 'contains', value: 'ACME CORP' }), input)
    ).toBe(true);
    expect(
      evaluateCondition(condition({ operator: 'contains', value: 'globex' }), input)
    ).toBe(false);
  });

  it('starts_with and ends_with match case-insensitively', () => {
    const input = makeInput({ subject: 'Alert: disk full' });
    expect(
      evaluateCondition(condition({ operator: 'starts_with', value: 'alert:' }), input)
    ).toBe(true);
    expect(
      evaluateCondition(condition({ operator: 'ends_with', value: 'DISK FULL' }), input)
    ).toBe(true);
    expect(
      evaluateCondition(condition({ operator: 'starts_with', value: 'disk' }), input)
    ).toBe(false);
  });

  it('requires ALL conditions to match', () => {
    const input = makeInput();
    const { matched, results } = evaluateConditions(
      [
        condition({ field: 'from_address', operator: 'contains', value: '@huntress.com' }),
        condition({ field: 'subject', operator: 'contains', value: 'no-such-text' }),
      ],
      input
    );
    expect(matched).toBe(false);
    expect(results.map((r) => r.passed)).toEqual([true, false]);
  });

  it('never matches an empty condition list', () => {
    expect(evaluateConditions([], makeInput()).matched).toBe(false);
  });

  it('derives from_domain from the sender address', () => {
    const input = buildRuleEmailInput({
      from: { email: 'Alerts <ALERTS@Huntress.COM>' },
      subject: 'x',
    });
    expect(input.fromDomain).toBe('huntress.com');
    expect(
      evaluateCondition(condition({ field: 'from_domain', operator: 'equals', value: 'huntress.com' }), input)
    ).toBe(true);
  });

  it('to_address matches when any recipient (to or cc) matches', () => {
    const input = buildRuleEmailInput({
      from: { email: 'a@b.com' },
      to: [{ email: 'first@msp.com' }],
      cc: [{ email: 'second@msp.com' }],
    });
    expect(
      evaluateCondition(condition({ field: 'to_address', operator: 'equals', value: 'second@msp.com' }), input)
    ).toBe(true);
    expect(
      evaluateCondition(condition({ field: 'to_address', operator: 'equals', value: 'third@msp.com' }), input)
    ).toBe(false);
  });

  it('slices body_text to the cap before evaluation', () => {
    const marker = 'NEEDLE-BEYOND-CAP';
    const body = 'x'.repeat(MAX_BODY_TEXT_LENGTH + 100) + marker;
    const input = buildRuleEmailInput({
      from: { email: 'a@b.com' },
      body: { text: body },
    });
    expect(input.bodyText.length).toBe(MAX_BODY_TEXT_LENGTH);
    expect(
      evaluateCondition(condition({ field: 'body_text', operator: 'contains', value: marker }), input)
    ).toBe(false);
  });

  it('matches_regex evaluates a valid pattern case-insensitively', () => {
    const input = makeInput({ subject: 'Ticket #4521 escalated' });
    expect(
      evaluateCondition(condition({ operator: 'matches_regex', value: 'ticket #\\d+' }), input)
    ).toBe(true);
  });

  it('treats an invalid regex as non-matching without throwing', () => {
    const input = makeInput();
    expect(
      evaluateCondition(condition({ operator: 'matches_regex', value: '([unclosed' }), input)
    ).toBe(false);
  });

  it('rejects patterns over the length cap', () => {
    const input = makeInput({ subject: 'aaa' });
    const oversized = 'a'.repeat(MAX_REGEX_PATTERN_LENGTH + 1);
    expect(
      evaluateCondition(condition({ operator: 'matches_regex', value: oversized }), input)
    ).toBe(false);
  });
});

describe('inboundEmailRules evaluator: extraction', () => {
  const subjectInput = makeInput({ subject: 'Critical Alert (Acme Corp) - EDR detection' });

  it('between extracts text inside delimiters', () => {
    const value = extractValue(
      { source: 'subject', extraction: { type: 'between', start: '(', end: ')' } },
      subjectInput
    );
    expect(value).toBe('Acme Corp');
  });

  it('between with a missing end delimiter is a non-match', () => {
    const value = extractValue(
      { source: 'subject', extraction: { type: 'between', start: '[', end: ']' } },
      subjectInput
    );
    expect(value).toBeNull();
  });

  it('between honors occurrence first vs last', () => {
    const input = makeInput({ subject: 'Alert (Acme Corp) resolved (Globex Inc)' });
    expect(
      extractValue(
        { source: 'subject', extraction: { type: 'between', start: '(', end: ')', occurrence: 'first' } },
        input
      )
    ).toBe('Acme Corp');
    expect(
      extractValue(
        { source: 'subject', extraction: { type: 'between', start: '(', end: ')', occurrence: 'last' } },
        input
      )
    ).toBe('Globex Inc');
  });

  it('after extracts text following the marker to end of line', () => {
    const input = makeInput({ bodyText: 'Severity: high\nCustomer: Acme Corp\nDevice: srv-01' });
    expect(
      extractValue(
        { source: 'body_text', extraction: { type: 'after', marker: 'Customer:' } },
        input
      )
    ).toBe('Acme Corp');
  });

  it('before extracts text preceding the marker', () => {
    const input = makeInput({ subject: 'Acme Corp - alert escalated' });
    expect(
      extractValue(
        { source: 'subject', extraction: { type: 'before', marker: '- alert' } },
        input
      )
    ).toBe('Acme Corp');
  });

  it('regex extraction returns capture group 1', () => {
    expect(
      extractValue(
        { source: 'subject', extraction: { type: 'regex', pattern: 'Alert \\(([^)]+)\\)' } },
        subjectInput
      )
    ).toBe('Acme Corp');
  });

  it('regex extraction without a capture group is a non-match', () => {
    expect(
      extractValue(
        { source: 'subject', extraction: { type: 'regex', pattern: 'Alert' } },
        subjectInput
      )
    ).toBeNull();
  });

  it('friendly templates compile to regex (single code path)', () => {
    const templateSource = extractionToRegexSource({ type: 'between', start: '(', end: ')' });
    expect(templateSource).toBeTruthy();
    const viaTemplate = extractValue(
      { source: 'subject', extraction: { type: 'between', start: '(', end: ')' } },
      subjectInput
    );
    const viaRegex = extractValue(
      { source: 'subject', extraction: { type: 'regex', pattern: templateSource! } },
      subjectInput
    );
    expect(viaTemplate).toBe(viaRegex);
  });

  it('handles unicode client names', () => {
    const input = makeInput({ subject: 'Alerte (Café Société) — détection' });
    expect(
      extractValue(
        { source: 'subject', extraction: { type: 'between', start: '(', end: ')' } },
        input
      )
    ).toBe('Café Société');
  });

  it('extraction from an empty source is a non-match', () => {
    const input = makeInput({ subject: '' });
    expect(
      extractValue(
        { source: 'subject', extraction: { type: 'between', start: '(', end: ')' } },
        input
      )
    ).toBeNull();
  });
});

describe('inboundEmailRules evaluator: normalization', () => {
  it('trims, collapses whitespace, and lowercases', () => {
    expect(normalizeExtractedValue('  Acme   Corp  ')).toBe('acme corp');
  });

  it('returns an empty string for empty/whitespace-only values', () => {
    expect(normalizeExtractedValue(null)).toBe('');
    expect(normalizeExtractedValue(undefined)).toBe('');
    expect(normalizeExtractedValue('   ')).toBe('');
  });
});
