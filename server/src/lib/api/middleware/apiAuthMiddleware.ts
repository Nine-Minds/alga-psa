/**
 * Improved API Authentication Middleware
 * Adds NM Store API key special-case (for allowed endpoints) and supports legacy usage.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiKeyServiceForApi } from '../../services/apiKeyServiceForApi';
import { findUserById } from '../../actions/user-actions/userActions';
import { runWithTenant } from '../../db';
import { 
  ApiRequest, 
  UnauthorizedError,
  handleApiError,
  BadRequestError
} from './apiMiddleware';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider.js';
import { runAsSystem } from '../services/SystemContext';

export interface ApiKeyAuthOptions {
  allowNmStore?: boolean;
  requireTenantForNmStore?: boolean;
  nmStoreAllowedPaths?: (string | RegExp)[]; // Restrict NM Store usage to these paths
}

let CACHED_NM_STORE_KEY: string | null = null;
let LAST_NM_STORE_FETCH = 0;
const NM_STORE_CACHE_TTL_MS = 60_000; // 1 minute
const DEFAULT_NM_STORE_ALLOWED_PATHS: (string | RegExp)[] = [
  /^\/api\/v1\/users\/search$/,
  /^\/api\/v1\/auth\/verify$/
];

async function getNmStoreApiKey(): Promise<string | null> {
  const now = Date.now();
  if (CACHED_NM_STORE_KEY && now - LAST_NM_STORE_FETCH < NM_STORE_CACHE_TTL_MS) {
    return CACHED_NM_STORE_KEY;
  }
  try {
    const secretProvider = await getSecretProviderInstance();
    const key = await secretProvider.getAppSecret('nm_store_api_key');
    CACHED_NM_STORE_KEY = key || null;
    LAST_NM_STORE_FETCH = now;
    return CACHED_NM_STORE_KEY;
  } catch {
    return null;
  }
}

function pathIsAllowed(pathname: string, allowed: (string | RegExp)[]): boolean {
  return allowed.some(p => typeof p === 'string' ? p === pathname : p.test(pathname));
}

// Overloaded signature to preserve legacy usage
export function withApiKeyAuth(handler: (req: ApiRequest) => Promise<NextResponse>): (req: NextRequest) => Promise<NextResponse>;
export function withApiKeyAuth(options: ApiKeyAuthOptions): (handler: (req: ApiRequest) => Promise<NextResponse>) => (req: NextRequest) => Promise<NextResponse>;
export function withApiKeyAuth(arg: any): any {
  const makeWrapper = (options: ApiKeyAuthOptions) => {
    const { allowNmStore = false, requireTenantForNmStore = true, nmStoreAllowedPaths } = options || {};
    const effectiveAllowedPaths = nmStoreAllowedPaths && nmStoreAllowedPaths.length > 0
      ? nmStoreAllowedPaths
      : DEFAULT_NM_STORE_ALLOWED_PATHS;

    return (handler: (req: ApiRequest) => Promise<NextResponse>) => {
      return async (req: NextRequest): Promise<NextResponse> => {
        try {
          const apiKey = req.headers.get('x-api-key');
          if (!apiKey) {
            throw new UnauthorizedError('API key required');
          }

          // NM Store global key path (only for allowed endpoints)
          if (allowNmStore) {
            const nmKey = await getNmStoreApiKey();
            if (nmKey && apiKey === nmKey) {
              const url = new URL(req.url);
              if (!pathIsAllowed(url.pathname, effectiveAllowedPaths)) {
                throw new UnauthorizedError('Invalid API key');
              }
              const tenantId = req.headers.get('x-tenant-id') || undefined;
              if (requireTenantForNmStore && !tenantId) {
                throw new BadRequestError('x-tenant-id header required for NM store key');
              }
              const apiRequest = req as ApiRequest;
              apiRequest.context = {
                userId: '00000000-0000-0000-0000-000000000000',
                tenant: (tenantId as string) || '',
                user: null,
                kind: 'system'
              } as any;
              // Ensure system operations are allowed for downstream createSystemContext()
              return await runAsSystem('withApiKeyAuth.system', async () => handler(apiRequest));
            }
          }

          // Default tenant API key path
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

          if (!keyRecord || !tenantId) {
            throw new UnauthorizedError('Invalid API key');
          }

          // Get user within tenant context
          let user;
          await runWithTenant(tenantId, async () => {
            user = await findUserById(keyRecord!.user_id);
          });
          if (!user) {
            throw new UnauthorizedError('User not found');
          }

          const apiRequest = req as ApiRequest;
          apiRequest.context = {
            userId: keyRecord.user_id,
            tenant: keyRecord.tenant,
            user,
            kind: 'user'
          } as any;

          return await runWithTenant(tenantId, async () => handler(apiRequest));
        } catch (error) {
          return handleApiError(error);
        }
      };
    };
  };

  // Legacy usage: withApiKeyAuth(handler)
  if (typeof arg === 'function') {
    const wrapperFactory = makeWrapper({ allowNmStore: false });
    return wrapperFactory(arg as (req: ApiRequest) => Promise<NextResponse>);
  }
  // New usage: withApiKeyAuth(options)(handler)
  return makeWrapper(arg as ApiKeyAuthOptions);
}
