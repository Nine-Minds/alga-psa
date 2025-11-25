import { NextResponse } from 'next/server';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

// Lightweight cache for the NM Store key to avoid repeated secret lookups
let CACHED_NM_STORE_KEY: string | null = null;
let LAST_FETCH = 0;
const TTL_MS = 60_000;

async function getNmStoreKey(): Promise<string | null> {
  const now = Date.now();
  if (CACHED_NM_STORE_KEY && now - LAST_FETCH < TTL_MS) return CACHED_NM_STORE_KEY;
  try {
    const secretProvider = await getSecretProviderInstance();
    const key = await secretProvider.getAppSecret('nm_store_api_key');
    CACHED_NM_STORE_KEY = key || null;
    LAST_FETCH = now;
    return CACHED_NM_STORE_KEY;
  } catch {
    return null;
  }
}

export function withNmStoreApiKey(
  handler: (req: Request) => Promise<NextResponse>
) {
  return async (req: Request): Promise<NextResponse> => {
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const nmKey = await getNmStoreKey();
    if (!nmKey || apiKey !== nmKey) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    return handler(req);
  };
}
