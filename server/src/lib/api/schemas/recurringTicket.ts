/**
 * Recurring Ticket API Schemas
 *
 * Only the API's own pieces live here: the query strings, the add-clients envelope and the path
 * parameters. The definition, client-update, preview and occurrence-filter contracts are the ones the
 * server actions already parse (`@alga-psa/tickets/lib/recurring/definitionInput`) and are imported
 * from there by the controller and the OpenAPI registration — nothing is re-declared.
 */

import { z } from 'zod';
import { uuidSchema } from './common';

export const RECURRING_LIST_STATUSES = ['active', 'paused', 'archived', 'all'] as const;

const pageSchema = z.string().transform((value) => parseInt(value, 10)).pipe(z.number().min(1)).prefault('1');
const limitSchema = z.string().transform((value) => parseInt(value, 10)).pipe(z.number().min(1).max(100)).prefault('25');

/** `GET /api/v1/tickets/recurring`. Not strict: shared list conventions (`sort`, `order`) are ignored. */
export const recurringTicketListQuerySchema = z.object({
  status: z.enum(RECURRING_LIST_STATUSES).prefault('all'),
  /** Case-insensitive substring of the definition name. */
  search: z.string().trim().min(1).optional(),
  page: pageSchema,
  limit: limitSchema,
});

/** `GET /api/v1/tickets/recurring/{definitionId}/occurrences`. `limit` becomes the action's `pageSize`. */
export const recurringTicketOccurrencesQuerySchema = z.object({
  status: z.enum(['created', 'skipped', 'missed', 'failed']).optional(),
  client_id: uuidSchema.optional(),
  page: pageSchema,
  limit: z.string().transform((value) => parseInt(value, 10)).pipe(z.number().min(1).max(200)).prefault('25'),
});

/** `POST /api/v1/tickets/recurring/{definitionId}/clients`: a thin envelope, the action takes a bare array. */
export const recurringTicketAddClientsSchema = z.object({
  client_ids: z.array(uuidSchema).min(1).max(100),
}).strict();

export const recurringDefinitionParamsSchema = z.object({
  definitionId: uuidSchema,
});

/** `clientId` is the client's `client_id`, not the surrogate `definition_client_id`. */
export const recurringDefinitionClientParamsSchema = z.object({
  definitionId: uuidSchema,
  clientId: uuidSchema,
});
