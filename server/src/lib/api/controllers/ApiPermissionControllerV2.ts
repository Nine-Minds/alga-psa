/**
 * API Permission Controller V2
 * Simplified version with proper API key authentication
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiBaseControllerV2 } from './ApiBaseControllerV2';
import { PermissionService } from '../services/PermissionService';
import { 
  createPermissionSchema,
  updatePermissionSchema,
  permissionListQuerySchema
} from '../schemas/permission';
import { 
  ApiKeyServiceForApi 
} from '../../services/apiKeyServiceForApi';
import { 
  findUserByIdForApi 
} from '../../actions/user-actions/findUserByIdForApi';
import { 
  runWithTenant 
} from '../../db';
import { 
  getConnection 
} from '../../db/db';
import { 
  hasPermission 
} from '../../auth/rbac';
import {
  ApiRequest,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  createSuccessResponse,
  createPaginatedResponse,
  handleApiError
} from '../middleware/apiMiddleware';
import { ZodError } from 'zod';

export class ApiPermissionControllerV2 extends ApiBaseControllerV2 {
  private permissionService: PermissionService;

  constructor() {
    const permissionService = new PermissionService();
    
    super(permissionService, {
      resource: 'permission',
      createSchema: createPermissionSchema,
      updateSchema: updatePermissionSchema,
      querySchema: permissionListQuerySchema,
      permissions: {
        create: 'create',
        read: 'read',
        update: 'update',
        delete: 'delete',
        list: 'read'
      }
    });
    
    this.permissionService = permissionService;
  }

  /**
   * Get permission categories
   */
  getCategories() {
    return async (req: NextRequest): Promise<NextResponse> => {
      try {
        // Authenticate
        const apiKey = req.headers.get('x-api-key');
        
        if (!apiKey) {
          throw new UnauthorizedError('API key required');
        }

        // Extract tenant ID
        let tenantId = req.headers.get('x-tenant-id');
        let keyRecord;

        if (tenantId) {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
        } else {
          keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
          if (keyRecord) {
            tenantId = keyRecord.tenant;
          }
        }
        
        if (!keyRecord) {
          throw new UnauthorizedError('Invalid API key');
        }

        // Get user
        const user = await findUserByIdForApi(keyRecord.user_id, tenantId!);

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check permissions
        const db = await getConnection(tenantId!);
        const hasReadPermission = await hasPermission(
          db,
          user.user_id,
          'permission:read',
          tenantId!
        );

        if (!hasReadPermission) {
          throw new ForbiddenError('Permission denied: Cannot read permission categories');
        }

        // Get categories within tenant context
        const categories = await runWithTenant(tenantId!, async () => {
          return await this.permissionService.getPermissionCategories({
            user,
            tenant: tenantId!,
            permissions: user.roles || []
          });
        });

        return createSuccessResponse(categories);
      } catch (error) {
        return handleApiError(error);
      }
    };
  }
}