import { z } from 'zod';

/**
 * Overrides of a recurring ticket's fields, at definition level and per client (plan §4.2). One schema serves both layers.
 *
 * Each group is either present (overridden) or absent (inherited from the definition). Groups keep
 * dependent fields consistent: a board override always carries its status (board and status are only
 * meaningful together), and an assignment override can deliberately mean "unassigned".
 */
const uuid = z.string().guid();

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

/**
 * The ticket fields a recurring ticket resolves, in cascade order (R1/R8):
 *
 *   ticket template (content)  ->  definition (dispatch: status, assignment)  ->  definition overrides  ->  client overrides
 *
 * The template supplies board, priority and category (all nullable there; a schedule needs a board and a
 * priority, which the reference check enforces on the EFFECTIVE values). The definition supplies the
 * dispatch fields. Every further layer is a {@link RecurringTicketOverrides} and replaces whole groups.
 */
export interface RecurringTemplateFields {
  board_id: string | null;
  status_id: string | null;
  priority_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  additional_agent_ids: string[];
}

/** Applies one override layer: present groups replace their fields as a unit, absent groups inherit. */
export function applyOverrides(
  fields: RecurringTemplateFields,
  overrides: RecurringTicketOverrides
): RecurringTemplateFields {
  return {
    ...fields,
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

/** An n-level fold: `base`, then each override layer in order (later layers win). */
export function resolveEffectiveFields(
  base: RecurringTemplateFields,
  ...layers: RecurringTicketOverrides[]
): RecurringTemplateFields {
  return layers.reduce(applyOverrides, base);
}
