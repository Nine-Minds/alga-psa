/**
 * API Board Controller
 * Handles board-related API endpoints
 */

import { ApiBaseController, AuthenticatedApiRequest } from './ApiBaseController';
import { BoardService } from '../services/BoardService';
import {
  BOARD_PERMISSION_DENIED,
  evaluateBoardMutationPolicy,
} from '@alga-psa/tickets/actions/board-actions/boardPolicy';
import { boardListQuerySchema, createBoardSchema, updateBoardSchema } from '../schemas/board';

export class ApiBoardController extends ApiBaseController {
  constructor() {
    const boardService = new BoardService();

    super(boardService, {
      resource: 'board',
      createSchema: createBoardSchema,
      updateSchema: updateBoardSchema,
      querySchema: boardListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
  }

  /**
   * Board writes are governed by the same policy as the board server actions
   * (packages/tickets boardPolicy): an internal principal holding
   * ticket_settings:<create|update|delete>. The generic 'ticket' resource is not
   * enough - it is held by every technician. Reads stay on ticket:read, as boards
   * are ticket reference data (the read server actions only require a session).
   */
  protected async checkPermission(req: AuthenticatedApiRequest, action: string): Promise<void> {
    const { hasPermission } = await import('@/lib/auth/rbac');
    const { getConnection } = await import('@/lib/db/db');
    const { ForbiddenError, UnauthorizedError } = await import('../middleware/apiMiddleware');

    if (!req.context?.user) {
      throw new UnauthorizedError('User context required');
    }

    const knex = await getConnection(req.context.tenant);

    if (action === 'create' || action === 'update' || action === 'delete') {
      const decision = await evaluateBoardMutationPolicy(
        { ...req.context.user, tenant: req.context.tenant },
        action,
        hasPermission,
        knex
      );
      if (!decision.allowed) {
        // Same non-leaky text for both refusals; the code is logged by the policy.
        throw new ForbiddenError(BOARD_PERMISSION_DENIED[action].message);
      }
      return;
    }

    if (!await hasPermission(req.context.user, 'ticket', action, knex)) {
      throw new ForbiddenError(`Permission denied: Cannot ${action} board`);
    }
  }
}
