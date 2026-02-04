/**
 * API Priority Controller
 * Handles priority-related API endpoints
 */

import { ApiBaseController, AuthenticatedApiRequest } from './ApiBaseController';
import { PriorityService } from '../services/PriorityService';
import { priorityListQuerySchema } from '../schemas/priority';

export class ApiPriorityController extends ApiBaseController {
  constructor() {
    const priorityService = new PriorityService();

    super(priorityService, {
      resource: 'priority',
      querySchema: priorityListQuerySchema,
      permissions: {
        read: 'read',
        list: 'read'
      }
    });
  }

  /**
   * Override permission check to use 'ticket' resource
   * since priorities are ticket reference data
   */
  protected async checkPermission(req: AuthenticatedApiRequest, action: string): Promise<void> {
    const { hasPermission } = await import('@/lib/auth/rbac');
    const { getConnection } = await import('@/lib/db/db');

    if (!req.context?.user) {
      const { UnauthorizedError } = await import('../middleware/apiMiddleware');
      throw new UnauthorizedError('User context required');
    }

    const knex = await getConnection(req.context.tenant);
    const hasAccess = await hasPermission(req.context.user, 'ticket', action, knex);

    if (!hasAccess) {
      const { ForbiddenError } = await import('../middleware/apiMiddleware');
      throw new ForbiddenError(`Permission denied: Cannot ${action} priority`);
    }
  }
}
