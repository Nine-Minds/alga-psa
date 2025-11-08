/**
 * Improved API Authentication Middleware
 * Handles API key authentication with proper tenant context
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiKeyServiceForApi } from '../../services/apiKeyServiceForApi';
import { findUserByIdForApi } from '../../actions/user-actions/findUserByIdForApi';
import { runWithTenant } from '../../db';
import { 
  ApiRequest, 
  UnauthorizedError,
  handleApiError 
} from './apiMiddleware';

/**
 * Enhanced authentication middleware that properly handles API key auth
 */
export async function withApiKeyAuth(
  handler: (req: ApiRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      const apiKey = req.headers.get('x-api-key');
      
      if (!apiKey) {
        throw new UnauthorizedError('API key required');
      }

      // First, try to get tenant from header
      let tenantId = req.headers.get('x-tenant-id');
      let keyRecord;

      if (tenantId) {
        // If tenant is provided, validate key for that specific tenant
        keyRecord = await ApiKeyServiceForApi.validateApiKeyForTenant(apiKey, tenantId);
      } else {
        // Otherwise, search across all tenants
        keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
        if (keyRecord) {
          tenantId = keyRecord.tenant;
        }
      }
      
      if (!keyRecord) {
        throw new UnauthorizedError('Invalid API key');
      }

      // Now we have a valid key and tenant, get the user within tenant context
      if (!tenantId) {
        throw new UnauthorizedError('Tenant ID not found');
      }
      
      const user = await findUserByIdForApi(keyRecord.user_id, tenantId);

      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      // Create an extended request with context
      const apiRequest = req as ApiRequest;
      apiRequest.context = {
        userId: keyRecord.user_id,
        tenant: keyRecord.tenant,
        user
      };

      // Run the handler within the tenant context
      return await runWithTenant(tenantId, async () => {
        return await handler(apiRequest);
      });
    } catch (error) {
      return handleApiError(error);
    }
  };
}
