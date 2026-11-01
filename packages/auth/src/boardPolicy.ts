/**
 * Board mutation policy, shared by every entry point that writes boards:
 * the server actions (createBoard / updateBoard / deleteBoard) and the REST
 * API (/api/v1/boards). It is deliberately a plain module, not "use server",
 * so non-async values can be exported and the server can import it.
 *
 * Two checks, always both, always in this order:
 *   1. principal  — board configuration is MSP-internal. Anything whose
 *      user_type is not 'internal' (client-portal users, unknown) is refused.
 *   2. permission — ticket_settings:<create|update|delete>, unconditionally.
 *
 * The result names the check that refused, so a portal user who also lacks the
 * permission (ticket_settings is MSP-only) is reported as a principal refusal,
 * not as a missing permission. The refusal is logged server-side with the
 * code; the caller-facing message stays the same non-leaky text for both.
 */

export type BoardMutationAction = 'create' | 'update' | 'delete';

export const BOARD_POLICY_PERMISSION_RESOURCE = 'ticket_settings';

export const BOARD_DENIAL_CODES = {
  principal: 'BOARD_PRINCIPAL_NOT_ALLOWED',
  permission: 'BOARD_PERMISSION_MISSING',
} as const;

export type BoardDenialCode = (typeof BOARD_DENIAL_CODES)[keyof typeof BOARD_DENIAL_CODES];

export const BOARD_PERMISSION_DENIED: Record<BoardMutationAction, { message: string; i18nKey: string }> = {
  create: { message: 'Permission denied: Cannot create boards', i18nKey: 'features/tickets:errors.settings.createDenied' },
  update: { message: 'Permission denied: Cannot update ticket settings', i18nKey: 'features/tickets:errors.settings.updateDenied' },
  delete: { message: 'Permission denied: Cannot delete boards', i18nKey: 'features/tickets:errors.settings.deleteDenied' },
};

export interface BoardPolicyUser {
  user_id?: string;
  user_type?: string | null;
  tenant?: string;
}

/** Injected so each layer uses its own RBAC lookup (auth package vs. server rbac). */
export type BoardPermissionChecker = (
  user: any,
  resource: string,
  action: string,
  trx?: any
) => Promise<boolean>;

export type BoardPolicyDecision =
  | { allowed: true }
  | { allowed: false; code: BoardDenialCode; permission: string };

export async function evaluateBoardMutationPolicy(
  user: BoardPolicyUser,
  action: BoardMutationAction,
  checkPermission: BoardPermissionChecker,
  trx?: unknown
): Promise<BoardPolicyDecision> {
  const permission = `${BOARD_POLICY_PERMISSION_RESOURCE}:${action}`;

  let decision: BoardPolicyDecision = { allowed: true };
  if (user.user_type !== 'internal') {
    decision = { allowed: false, code: BOARD_DENIAL_CODES.principal, permission };
  } else if (!await checkPermission(user, BOARD_POLICY_PERMISSION_RESOURCE, action, trx)) {
    decision = { allowed: false, code: BOARD_DENIAL_CODES.permission, permission };
  }

  if (!decision.allowed) {
    console.warn('[boards] mutation refused', {
      code: decision.code,
      action,
      permission,
      userId: user.user_id,
      userType: user.user_type,
      tenant: user.tenant,
    });
  }
  return decision;
}
