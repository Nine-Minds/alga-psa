import { z } from 'zod';

/**
 * Per-client overrides of a recurring-ticket definition (plan §4.2).
 *
 * Each group is either present (overridden) or absent (inherited from the definition). Groups keep
 * dependent fields consistent: a board override always carries its status (board and status are only
 * meaningful together), and an assignment override can deliberately mean "unassigned".
 */
const uuid = z.string().uuid();

export const recurringTicketOverridesSchema = z
  .object({
    board: z.object({ board_id: uuid, status_id: uuid.nullable() }).strict().optional(),
    priority: z.object({ priority_id: uuid }).strict().optional(),
    category: z
      .object({ category_id: uuid.nullable(), subcategory_id: uuid.nullable() })
      .strict()
      .refine((value) => value.category_id !== null || value.subcategory_id === null, {
        message: 'A subcategory requires a category',
        path: ['subcategory_id'],
      })
      .optional(),
    assignment: z
      .object({
        assigned_to: uuid.nullable(),
        assigned_team_id: uuid.nullable(),
        additional_agent_ids: z.array(uuid),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RecurringTicketOverrides = z.infer<typeof recurringTicketOverridesSchema>;

/** The template fields of a definition that a client can override. */
export interface RecurringTemplateFields {
  board_id: string;
  status_id: string | null;
  priority_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  additional_agent_ids: string[];
}

/** Definition defaults, then the client's overridden groups. Group fields are replaced as a unit. */
export function resolveEffectiveFields(
  defaults: RecurringTemplateFields,
  overrides: RecurringTicketOverrides
): RecurringTemplateFields {
  return {
    ...defaults,
    ...(overrides.board ? { board_id: overrides.board.board_id, status_id: overrides.board.status_id } : {}),
    ...(overrides.priority ? { priority_id: overrides.priority.priority_id } : {}),
    ...(overrides.category
      ? { category_id: overrides.category.category_id, subcategory_id: overrides.category.subcategory_id }
      : {}),
    ...(overrides.assignment
      ? {
          assigned_to: overrides.assignment.assigned_to,
          assigned_team_id: overrides.assignment.assigned_team_id,
          additional_agent_ids: overrides.assignment.additional_agent_ids,
        }
      : {}),
  };
}
