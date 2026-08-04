import { z } from 'zod';

export const CANCELLATION_REASON_CATEGORIES = [
  'Pricing too high',
  'Missing features I need',
  'Poor customer support',
  'Switching to competitor',
  'No longer need the service',
  'Other',
] as const;

export const cancellationFeedbackSchema = z.object({
  reasonCategory: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(CANCELLATION_REASON_CATEGORIES).optional()
  ),
  reasonText: z.string().trim(),
});

export type CancellationReasonCategory = (typeof CANCELLATION_REASON_CATEGORIES)[number];
export type CancellationFeedback = z.infer<typeof cancellationFeedbackSchema>;
