import { z } from 'zod';

export const tenantIdSchema = z.string().min(1).describe('Tenant ID');
export const occurredAtSchema = z.string().datetime().describe('Timestamp when the event occurred (ISO 8601)');

export const uuidSchema = (label: string) => z.string().uuid().describe(label);

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const isCalendarDate = (value: string): boolean => {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

// Calendar date string (YYYY-MM-DD). This does the same check as z.string().date(), which
// needs zod >= 3.23. The workflow worker bundles these schemas with its own zod 3.22.4.
// LEVERAGE: friction worker-zod-pin — services/workflow-worker pins zod 3.22.4 while the schema
// packages it compiles declare ^3.23.8. Aligning the pin would let these schemas use zod's own APIs.
export const dateOnlySchema = (label: string) =>
  z.string().regex(DATE_ONLY_PATTERN, 'Expected a YYYY-MM-DD date').refine(isCalendarDate, 'Invalid calendar date').describe(label);

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
