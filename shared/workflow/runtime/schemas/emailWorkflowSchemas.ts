import { z } from 'zod';

export const emailWorkflowPayloadSchema = z.object({
  emailData: z.record(z.any()).optional(),
  providerId: z.string().optional(),
  tenantId: z.string().optional(),
  processedAt: z.string().optional(),
  parsedEmail: z.record(z.any()).optional(),
  existingTicket: z.record(z.any()).optional(),
  matchedClient: z.record(z.any()).optional(),
  ticketDefaults: z.record(z.any()).optional(),
  targetTicketId: z.string().optional()
});

export type EmailWorkflowPayload = z.infer<typeof emailWorkflowPayloadSchema>;
