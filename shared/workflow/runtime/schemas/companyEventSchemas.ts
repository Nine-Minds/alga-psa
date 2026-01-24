import { z } from 'zod';
import { BaseDomainEventPayloadSchema, changesSchema, updatedFieldsSchema, uuidSchema } from './commonEventPayloadSchemas';

const companyIdSchema = uuidSchema('Company ID');
const userIdSchema = uuidSchema('User ID');

export const companyCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  companyId: companyIdSchema,
  companyName: z.string().min(1).optional(),
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for COMPANY_CREATED');

export type CompanyCreatedEventPayload = z.infer<typeof companyCreatedEventPayloadSchema>;

export const companyUpdatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  companyId: companyIdSchema,
  updatedByUserId: userIdSchema.optional(),
  updatedAt: z.string().datetime().optional(),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for COMPANY_UPDATED');

export type CompanyUpdatedEventPayload = z.infer<typeof companyUpdatedEventPayloadSchema>;
