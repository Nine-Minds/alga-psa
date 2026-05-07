/**
 * Improved API Authentication Middleware
 * Handles API key authentication with proper tenant context
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiKeyServiceForApi } from '../../services/apiKeyServiceForApi';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { runWithTenant } from '../../db';
import { getTenantProduct, ProductAccessError } from '@/lib/productAccess';
import { resolveProductApiBehavior } from '@/lib/productSurfaceRegistry';
import { 
  ApiRequest, 
  UnauthorizedError,
  handleApiError 
} from './apiMiddleware';
import { enforceApiRateLimit } from '../rateLimit/enforce';

export interface AuthenticateApiKeyRequestOptions {
  allowBearerToken?: boolean;
}

function extractApiKeyFromRequest(
  req: NextRequest,
  options: AuthenticateApiKeyRequestOptions = {},
): string | null {
  const headerApiKey = req.headers.get('x-api-key');
  if (headerApiKey) {
    return headerApiKey;
  }

  if (!options.allowBearerToken) {
    return null;
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

export async function authenticateApiKeyRequest(
  req: NextRequest,
  options: AuthenticateApiKeyRequestOptions = {},
): Promise<ApiRequest> {
  const apiKey = extractApiKeyFromRequest(req, options);

  if (!apiKey) {
    throw new UnauthorizedError('API key required');
  }

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

  if (!tenantId) {
    throw new UnauthorizedError('Tenant ID not found');
  }

  const user = await findUserByIdForApi(keyRecord.user_id, tenantId);
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const apiRequest = req as ApiRequest;
  apiRequest.context = {
    userId: keyRecord.user_id,
    tenant: keyRecord.tenant,
    user,
    apiKeyId: keyRecord.api_key_id,
  };
  apiRequest.context.rateLimit = await enforceApiRateLimit(apiRequest, apiRequest.context);

  return apiRequest;
}

/**
 * Enhanced authentication middleware that properly handles API key auth
 */
export async function withApiKeyAuth(
  handler: (req: ApiRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      const apiRequest = await authenticateApiKeyRequest(req);

      const productCode = await getTenantProduct(apiRequest.context!.tenant);
      const pathname = new URL(req.url).pathname;
      if (resolveProductApiBehavior(productCode, pathname) === 'denied') {
        throw new ProductAccessError(`api:${pathname}`, productCode);
      }

      // Run the handler within the tenant context
      return await runWithTenant(apiRequest.context!.tenant, async () => {
        return await handler(apiRequest);
      });
    } catch (error) {
      return handleApiError(error);
    }
  };
}
