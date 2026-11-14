import { z } from 'zod';

/**
 * Write-side input contract for createBoard / updateBoard.
 *
 * Both schemas are strict: an unknown key (tenant, board_id, a made-up column,
 * or one of the dead display_* columns) or a wrongly typed value is rejected
 * before anything is read or written, and the parsed result is the explicit
 * projection of writable columns the actions persist. Nothing the caller sent
 * outside this list can reach the database.
 *
 * The list is derived from IBoard and from what BoardsSettings and the
 * onboarding TicketingConfigStep actually send. `board_id` and `tenant` are
 * never writable. `list_view_settings` is only checked for presence here; its
 * content is validated strictly by parseTicketViewSettings on write.
 *
 * Lives outside boardActions.ts because that module is "use server" and may not
 * export non-async values.
 */

const nullableString = z.string().nullable().optional();

const boardTicketStatusInputSchema = z
  .object({
    status_id: z.string().optional(),
    name: z.string(),
    is_closed: z.boolean(),
    is_default: z.boolean().optional(),
    order_number: z.number().optional(),
    color: nullableString,
    icon: nullableString,
    portal_selectable: z.boolean().optional(),
  })
  .strict();

const writableBoardColumns = {
  board_name: z.string().min(1),
  description: nullableString,
  display_order: z.number().int().optional(),
  is_inactive: z.boolean().optional(),
  is_default: z.boolean().optional(),
  category_type: z.enum(['custom', 'itil']).optional(),
  priority_type: z.enum(['custom', 'itil']).optional(),
  display_itil_impact: z.boolean().optional(),
  display_itil_urgency: z.boolean().optional(),
  default_assigned_to: nullableString,
  default_assigned_team_id: nullableString,
  default_priority_id: nullableString,
  manager_user_id: nullableString,
  sla_policy_id: nullableString,
  inbound_reply_reopen_enabled: z.boolean().optional(),
  inbound_reply_reopen_cutoff_hours: z.number().optional(),
  inbound_reply_reopen_status_id: nullableString,
  inbound_reply_ai_ack_suppression_enabled: z.boolean().optional(),
  enable_live_ticket_timer: z.boolean().nullable().optional(),
  client_portal_visible: z.boolean().nullable().optional(),
  is_pinned: z.boolean().optional(),
  ticket_statuses: z.array(boardTicketStatusInputSchema).optional(),
};

export const createBoardInputSchema = z
  .object({
    ...writableBoardColumns,
    copy_ticket_statuses_from_board_id: nullableString,
  })
  .strict();

export const updateBoardInputSchema = z
  .object({
    ...writableBoardColumns,
    board_name: writableBoardColumns.board_name.optional(),
    list_view_settings: z.unknown().optional(),
  })
  .strict();

export type ParsedCreateBoardInput = z.infer<typeof createBoardInputSchema>;
export type ParsedUpdateBoardInput = z.infer<typeof updateBoardInputSchema>;
