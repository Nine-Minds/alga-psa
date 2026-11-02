import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { writeFile } from 'node:fs/promises';
import { getTenantContext, resetTenantConnectionPool } from '@alga-psa/db';

const routeModule = process.env.COLD_RBAC_ROUTE_MODULE;
const requestUrl = process.env.COLD_RBAC_URL;
const authorizedKey = process.env.COLD_RBAC_AUTHORIZED_KEY;
const unauthorizedKey = process.env.COLD_RBAC_UNAUTHORIZED_KEY;
const assetId = process.env.COLD_RBAC_ASSET_ID;
const resultPath = process.env.COLD_RBAC_RESULT_FILE;
const expectedAuthorizedStatus = Number(process.env.COLD_RBAC_AUTHORIZED_STATUS);

type ProbeResult = {
  initialTenant: string | null;
  authorizedStatus: number;
  authorizedErrorCode: string | null;
  unauthorizedStatus: number;
  unauthorizedErrorCode: string | null;
  finalTenant: string | null;
};

async function invoke(route: Record<string, any>, apiKey: string) {
  const request = new NextRequest(requestUrl!, { headers: { 'x-api-key': apiKey } });
  const response = routeModule?.includes('/assets/[id]')
    ? await route.GET(request, { params: Promise.resolve({ id: assetId }) })
    : await route.GET(request);
  const body = await response.json().catch(() => null);
  return { status: response.status, errorCode: body?.error?.code ?? null };
}

describe('fresh-process API-key RBAC probe', () => {
  afterAll(async () => {
    await resetTenantConnectionPool();
  });

  it('authorizes the first valid request and denies a valid caller without the MSP grant', async () => {
    expect(routeModule).toBeTruthy();
    expect(requestUrl).toBeTruthy();
    expect(authorizedKey).toBeTruthy();
    expect(unauthorizedKey).toBeTruthy();
    expect(resultPath).toBeTruthy();

    const initialTenant = getTenantContext() ?? null;
    const route = await import(routeModule!);
    const authorized = await invoke(route, authorizedKey!);
    const unauthorized = await invoke(route, unauthorizedKey!);
    const result: ProbeResult = {
      initialTenant,
      authorizedStatus: authorized.status,
      authorizedErrorCode: authorized.errorCode,
      unauthorizedStatus: unauthorized.status,
      unauthorizedErrorCode: unauthorized.errorCode,
      finalTenant: getTenantContext() ?? null,
    };

    await writeFile(resultPath!, JSON.stringify(result));
    expect(initialTenant).toBeNull();
    expect(authorized.status).toBe(expectedAuthorizedStatus);
    expect(unauthorized.status).toBe(403);
    expect(unauthorized.errorCode).toBe('FORBIDDEN');
    expect(result.finalTenant).toBeNull();
  });
});
