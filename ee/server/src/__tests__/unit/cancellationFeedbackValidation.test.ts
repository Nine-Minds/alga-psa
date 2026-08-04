import { describe, expect, it } from 'vitest';
import {
  cancellationFeedbackSchema,
} from '../../lib/cancellationFeedbackValidation';

describe('cancellationFeedbackSchema', () => {
  it('rejects an unknown category', () => {
    const result = cancellationFeedbackSchema.safeParse({
      reasonCategory: 'Not a category',
      reasonText: 'Optional feedback',
    });

    expect(result.success).toBe(false);
  });

  it.each(['', '.', 'Brief'])('accepts optional feedback of any length: %j', (reasonText) => {
    const result = cancellationFeedbackSchema.safeParse({
      reasonCategory: '',
      reasonText,
    });

    expect(result).toEqual({
      success: true,
      data: {
        reasonCategory: undefined,
        reasonText,
      },
    });
  });

  it('accepts unbounded feedback and trims surrounding whitespace', () => {
    const reasonText = 'x'.repeat(5_000);
    const result = cancellationFeedbackSchema.safeParse({
      reasonCategory: 'Pricing too high',
      reasonText: `  ${reasonText}  `,
    });

    expect(result).toEqual({
      success: true,
      data: {
        reasonCategory: 'Pricing too high',
        reasonText,
      },
    });
  });
});
