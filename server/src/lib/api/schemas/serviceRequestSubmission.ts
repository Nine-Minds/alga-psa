import { z } from 'zod';

const uuid = z.string().uuid();

export const serviceRequestCatalogQuerySchema = z.object({
  clientId: uuid,
  contactId: uuid,
});

export const serviceRequestSubmissionBodySchema = z.object({
  clientId: uuid,
  contactId: uuid,
  /** Answers keyed by the definition's form field keys. */
  payload: z.record(z.string(), z.unknown()),
  /** Optional idempotency key (UUID). A repeated key returns the original submission. */
  clientSubmissionKey: uuid.optional(),
});

export type ServiceRequestSubmissionBody = z.infer<typeof serviceRequestSubmissionBodySchema>;

export const serviceRequestSubmissionParamsSchema = z.object({ definitionId: uuid });
