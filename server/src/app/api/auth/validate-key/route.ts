import { NextRequest, NextResponse } from 'next/server';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

// Cache for special keys
let NM_STORE_KEY_CACHE: string | null = null;
let NM_STORE_KEY_LAST_FETCH = 0;
const NM_STORE_KEY_TTL_MS = 60_000;

let RUNNER_KEY_CACHE: string | null = null;
let RUNNER_KEY_LAST_FETCH = 0;
const RUNNER_KEY_TTL_MS = 60_000;

async function getNmStoreKey(): Promise<string | null> {
  const now = Date.now();
  if (NM_STORE_KEY_CACHE && now - NM_STORE_KEY_LAST_FETCH < NM_STORE_KEY_TTL_MS) {
    return NM_STORE_KEY_CACHE;
  }
  
  try {
    const secretProvider = await getSecretProviderInstance();
    const key = await secretProvider.getAppSecret('nm_store_api_key');
    NM_STORE_KEY_CACHE = key || null;
    NM_STORE_KEY_LAST_FETCH = now;
    return NM_STORE_KEY_CACHE;
  } catch {
    return null;
  }
}

async function getRunnerAllowKey(): Promise<string | null> {
  const now = Date.now();
  if (RUNNER_KEY_CACHE && now - RUNNER_KEY_LAST_FETCH < RUNNER_KEY_TTL_MS) {
    return RUNNER_KEY_CACHE;
  }
  
  try {
    const secretProvider = await getSecretProviderInstance();
    const key = await secretProvider.getAppSecret('ALGA_AUTH_KEY') || 
                await secretProvider.getAppSecret('alga_auth_key') ||
                process.env.ALGA_AUTH_KEY;
    
    RUNNER_KEY_CACHE = key || null;
    RUNNER_KEY_LAST_FETCH = now;
    return RUNNER_KEY_CACHE;
  } catch {
    const key = process.env.ALGA_AUTH_KEY;
    RUNNER_KEY_CACHE = key || null;
    RUNNER_KEY_LAST_FETCH = now;
    return RUNNER_KEY_CACHE;
  }
}

/**
 * Internal API endpoint to validate API keys
 * Called by the middleware since Edge Runtime can't use Node.js modules
 */
export async function POST(request: NextRequest) {
  try {
    const { apiKey, pathname } = await request.json();
    
    if (!apiKey) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }
    
    // Normalize path
    const normalizedPath = pathname.endsWith('/') && pathname.length > 1 
      ? pathname.slice(0, -1) 
      : pathname;
    
    // Check NM Store endpoints
    if (normalizedPath === '/api/v1/users/search' || normalizedPath === '/api/v1/auth/verify') {
      const nmKey = await getNmStoreKey();
      if (nmKey && apiKey === nmKey) {
        return NextResponse.json({ 
          valid: true, 
          special: true,
          type: 'nm_store'
        });
      }
    }
    
    // Check Runner endpoints
    if (normalizedPath === '/api/installs/lookup-by-host' || normalizedPath === '/api/installs/validate') {
      const runnerKey = await getRunnerAllowKey();
      if (runnerKey && apiKey === runnerKey) {
        return NextResponse.json({ 
          valid: true, 
          special: true,
          type: 'runner'
        });
      }
    }
    
    // Validate against database
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    
    if (!keyRecord) {
      return NextResponse.json({ valid: false }, { status: 401 });
    }
    
    return NextResponse.json({
      valid: true,
      userId: keyRecord.user_id,
      tenant: keyRecord.tenant
    });
    
  } catch (error) {
    console.error('Error validating API key:', error);
    return NextResponse.json(
      { valid: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}