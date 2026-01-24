import { z } from 'zod';

export const tenantIdSchema = z.string().min(1).describe('Tenant ID');
export const occurredAtSchema = z.string().datetime().describe('Timestamp when the event occurred (ISO 8601)');

export const uuidSchema = (label: string) => z.string().uuid().describe(label);

export const actorTypeSchema = z.enum(['USER', 'CONTACT', 'SYSTEM']).describe('Actor type');

export const BaseDomainEventPayloadSchema = z.object({
  tenantId: tenantIdSchema,
  occurredAt: occurredAtSchema,
  actorUserId: uuidSchema('Actor User ID').optional(),
  actorContactId: uuidSchema('Actor Contact ID').optional(),
  actorType: actorTypeSchema.optional(),
});

export const updatedFieldsSchema = z.array(z.string()).describe('Dot-paths of updated fields').optional();

export const changesSchema = z
  .record(
    z.object({
      previous: z.unknown(),
      new: z.unknown(),
    })
  )
  .describe('Map of dot-path -> { previous, new }')
  .optional();

export const currencySchema = z.string().min(1).describe('Currency code (e.g., USD)');
