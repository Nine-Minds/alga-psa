import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { writeFile } from 'node:fs/promises';
import { getTenantContext, resetTenantConnectionPool } from '@alga-psa/db';

const routeModule = process.env.COLD_RBAC_ROUTE_MODULE;
const requestUrl = process.env.COLD_RBAC_URL;
const apiKey = process.env.COLD_RBAC_API_KEY;
const assetId = process.env.COLD_RBAC_ASSET_ID;
const resultPath = process.env.COLD_RBAC_RESULT_FILE;
const expectedStatus = Number(process.env.COLD_RBAC_EXPECTED_STATUS);

type ProbeResult = {
  initialTenant: string | null;
  status: number;
  errorCode: string | null;
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

  it('evaluates the first API-key request in a cold process', async () => {
    expect(routeModule).toBeTruthy();
    expect(requestUrl).toBeTruthy();
    expect(apiKey).toBeTruthy();
    expect(resultPath).toBeTruthy();

    const initialTenant = getTenantContext() ?? null;
    const route = await import(routeModule!);
    const response = await invoke(route, apiKey!);
    const result: ProbeResult = {
      initialTenant,
      status: response.status,
      errorCode: response.errorCode,
      finalTenant: getTenantContext() ?? null,
    };

    await writeFile(resultPath!, JSON.stringify(result));
    expect(initialTenant).toBeNull();
    expect(response.status).toBe(expectedStatus);
    expect(result.finalTenant).toBeNull();
  });
});
