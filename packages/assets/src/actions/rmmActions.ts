import type { RmmCachedData } from '@alga-psa/types';

type RmmGetResponse =
  | { data: RmmCachedData; message?: string }
  | { data: null; message?: string }
  | { error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

export async function getAssetRmmData(assetId: string): Promise<RmmCachedData | null> {
  const res = await fetch(`/api/v1/assets/${assetId}/rmm`, { cache: 'no-store' });
  const json: unknown = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = isObject(json) && typeof json.error === 'string'
      ? json.error
      : `Failed to get RMM data (HTTP ${res.status})`;
    throw new Error(message);
  }

  const payload = json as RmmGetResponse;
  return 'data' in payload ? (payload.data ?? null) : null;
}

export async function refreshAssetRmmData(assetId: string): Promise<RmmCachedData | null> {
  const res = await fetch(`/api/v1/assets/${assetId}/rmm/refresh`, {
    method: 'POST',
    cache: 'no-store',
  });

  const json: unknown = await res.json().catch(() => ({}));

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const message = isObject(json) && typeof json.error === 'string'
      ? json.error
      : `Failed to refresh RMM data (HTTP ${res.status})`;
    throw new Error(message);
  }

  const payload = json as RmmGetResponse;
  return 'data' in payload ? (payload.data ?? null) : null;
}

