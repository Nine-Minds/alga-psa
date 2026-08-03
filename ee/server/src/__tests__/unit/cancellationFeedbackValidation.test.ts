import { describe, expect, it } from 'vitest';
import {
  CANCELLATION_FEEDBACK_MAX_LENGTH,
  CANCELLATION_FEEDBACK_MIN_LENGTH,
  cancellationFeedbackSchema,
} from '../../lib/cancellationFeedbackValidation';

describe('cancellationFeedbackSchema', () => {
  it.each(['', 'Not a category'])('rejects an unknown category: %j', (reasonCategory) => {
    const result = cancellationFeedbackSchema.safeParse({
      reasonCategory,
      reasonText: 'This feedback is long enough to submit.',
    });

    expect(result.success).toBe(false);
  });

  it.each(['', '.', 'Too little detail'])('rejects low-information feedback: %j', (reasonText) => {
    const result = cancellationFeedbackSchema.safeParse({
      reasonCategory: 'Other',
      reasonText,
    });

    expect(result.success).toBe(false);
  });

  it('rejects feedback over the existing maximum length', () => {
    const result = cancellationFeedbackSchema.safeParse({
      reasonCategory: 'Other',
      reasonText: 'x'.repeat(CANCELLATION_FEEDBACK_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });

  it('accepts and trims feedback at the minimum length', () => {
    const reasonText = 'x'.repeat(CANCELLATION_FEEDBACK_MIN_LENGTH);
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
