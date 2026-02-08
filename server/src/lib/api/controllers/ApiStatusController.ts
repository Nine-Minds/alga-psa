/**
 * API Status Controller
 * Handles status-related API endpoints
 */

import { ApiBaseController, AuthenticatedApiRequest } from './ApiBaseController';
import { StatusService } from '../services/StatusService';
import { statusListQuerySchema } from '../schemas/status';

export class ApiStatusController extends ApiBaseController {
  constructor() {
    const statusService = new StatusService();

    super(statusService, {
      resource: 'status',
      querySchema: statusListQuerySchema,
      permissions: {
        read: 'read',
        list: 'read'
      }
    });
  }

  /**
   * Override permission check to use 'ticket' resource
   * since statuses are ticket reference data
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
      throw new ForbiddenError(`Permission denied: Cannot ${action} status`);
    }
  }
}
