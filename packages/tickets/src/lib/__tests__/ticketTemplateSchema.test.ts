import { describe, expect, it } from 'vitest';
import { ticketTemplateInputSchema, ticketTitleSchema } from '../ticketTemplateSchema';

describe('ticketTitleSchema (token validation, R8)', () => {
  it('trims and accepts every known token', () => {
    expect(ticketTitleSchema.parse('  {{client}} {{contact}} {{due_date}} {{month}} {{year}}  ')).toBe(
      '{{client}} {{contact}} {{due_date}} {{month}} {{year}}'
    );
  });

  it('rejects unknown tokens naming every one of them, with a localizable key', () => {
    const result = ticketTitleSchema.safeParse('{{client}} {{quarter}} {{week}}');
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0] as any;
      expect(issue.params.messageKey).toBe('features/tickets:templates.errors.unknownTitleTokens');
      expect(issue.params.messageParams.tokens).toBe('{{quarter}}, {{week}}');
      expect(issue.params.messageParams.available).toContain('{{contact}}');
    }
  });

  it('rejects empty and over-long titles', () => {
    expect(ticketTitleSchema.safeParse('  ').success).toBe(false);
    expect(ticketTitleSchema.safeParse('a'.repeat(501)).success).toBe(false);
  });
});

describe('ticketTemplateInputSchema', () => {
  it('rejects a template whose title has an unknown token', () => {
    expect(ticketTemplateInputSchema.safeParse({ name: 'N', title: 'Hello {{nope}}' }).success).toBe(false);
    expect(ticketTemplateInputSchema.safeParse({ name: 'N', title: 'Hello {{client}}' }).success).toBe(true);
  });

  it('leaves offer_for_manual_use undefined when omitted (update keeps the stored value)', () => {
    expect(ticketTemplateInputSchema.parse({ name: 'N', title: 'T' }).offer_for_manual_use).toBeUndefined();
    expect(ticketTemplateInputSchema.parse({ name: 'N', title: 'T', offer_for_manual_use: false }).offer_for_manual_use).toBe(false);
  });
});
