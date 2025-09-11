import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

// Cache for special keys to avoid frequent secret provider calls
let NM_STORE_KEY_CACHE: string | null = null;
let NM_STORE_KEY_LAST_FETCH = 0;
const NM_STORE_KEY_TTL_MS = 60_000; // 1 minute

let RUNNER_KEY_CACHE: string | null = null;
let RUNNER_KEY_LAST_FETCH = 0;
const RUNNER_KEY_TTL_MS = 60_000; // 1 minute

/**
 * Get NM Store API key with caching
 */
export async function getNmStoreKey(): Promise<string | null> {
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
  } catch (error) {
    console.error('Failed to get NM Store key:', error);
    return null;
  }
}

/**
 * Get Runner allow key with caching
 */
export async function getRunnerAllowKey(): Promise<string | null> {
  const now = Date.now();
  if (RUNNER_KEY_CACHE && now - RUNNER_KEY_LAST_FETCH < RUNNER_KEY_TTL_MS) {
    return RUNNER_KEY_CACHE;
  }
  
  try {
    const secretProvider = await getSecretProviderInstance();
    const key = await secretProvider.getAppSecret('ALGA_AUTH_KEY') || 
                await secretProvider.getAppSecret('alga_auth_key') ||
                process.env.ALGA_AUTH_KEY ||
                (process.env as any).alga_auth_key;
    
    RUNNER_KEY_CACHE = key || null;
    RUNNER_KEY_LAST_FETCH = now;
    return RUNNER_KEY_CACHE;
  } catch (error) {
    // Fallback to env vars if secret provider fails
    const key = process.env.ALGA_AUTH_KEY || (process.env as any).alga_auth_key;
    RUNNER_KEY_CACHE = key || null;
    RUNNER_KEY_LAST_FETCH = now;
    return RUNNER_KEY_CACHE;
  }
}

/**
 * Validate special API keys (NM Store, Runner)
 */
export async function validateSpecialKeys(apiKey: string, pathname: string): Promise<{ valid: boolean; tenant?: string; userId?: string }> {
  // Normalize path (remove trailing slash if present)
  const normalizedPath = pathname.endsWith('/') && pathname.length > 1 
    ? pathname.slice(0, -1) 
    : pathname;
  
  // Check NM Store endpoints
  const isNmAllowedPath = 
    normalizedPath === '/api/v1/users/search' ||
    normalizedPath === '/api/v1/auth/verify';
  
  if (isNmAllowedPath) {
    const nmKey = await getNmStoreKey();
    if (nmKey && apiKey === nmKey) {
      // NM Store key is valid for these specific endpoints
      return { valid: true };
    }
  }
  
  // Check Runner endpoints
  const isRunnerPath = 
    normalizedPath === '/api/installs/lookup-by-host' ||
    normalizedPath === '/api/installs/validate';
  
  if (isRunnerPath) {
    const runnerKey = await getRunnerAllowKey();
    if (runnerKey && apiKey === runnerKey) {
      // Runner key is valid for these specific endpoints
      return { valid: true };
    }
  }
  
  return { valid: false };
}

/**
 * Check if a path should skip API authentication
 */
export function shouldSkipApiAuth(pathname: string): boolean {
  const skipPaths = [
    '/api/auth/',
    '/api/health',
    '/api/healthz',
    '/api/readyz',
    '/api/documents/download/',
    '/api/documents/view/',
    '/api/email/webhooks/google',
    '/api/email/webhooks/microsoft',
    '/api/email/oauth/initiate'
  ];
  
  return skipPaths.some(path => pathname.startsWith(path));
}

/**
 * Mask API key for logging
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return 'none';
  const len = key.length;
  const prefix = key.slice(0, 4);
  const suffix = key.slice(Math.max(0, len - 2));
  return `${prefix}***${suffix} (len=${len})`;
}