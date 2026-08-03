import { z } from 'zod';

export const CANCELLATION_REASON_CATEGORIES = [
  'Pricing too high',
  'Missing features I need',
  'Poor customer support',
  'Switching to competitor',
  'No longer need the service',
  'Other',
] as const;

export const CANCELLATION_FEEDBACK_MIN_LENGTH = 20;
export const CANCELLATION_FEEDBACK_MAX_LENGTH = 500;

export const cancellationFeedbackSchema = z.object({
  reasonCategory: z.enum(CANCELLATION_REASON_CATEGORIES),
  reasonText: z
    .string()
    .trim()
    .min(CANCELLATION_FEEDBACK_MIN_LENGTH)
    .max(CANCELLATION_FEEDBACK_MAX_LENGTH),
});

export type CancellationReasonCategory = (typeof CANCELLATION_REASON_CATEGORIES)[number];
export type CancellationFeedback = z.infer<typeof cancellationFeedbackSchema>;
