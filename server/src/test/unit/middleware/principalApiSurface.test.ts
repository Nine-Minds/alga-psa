import { describe, expect, it } from 'vitest';
import { principalApiKeyPrefix, principalKindOfApiKey } from '@alga-psa/types';
import { CO_MANAGED_SEAT_SURFACE, surfaceAllowsApiRequest } from '@shared/services/productSurfaceKinds';
import { principalApiSurfaceResponse, principalKindOfRequest } from 'server/src/middleware/principalApiSurface';

// A seat technician's mobile session key carries the seat prefix, and the edge holds it to the seat's API surface
// before any route handler (including the ones that skip the edge API-key check) runs.

const seatKey = `${principalApiKeyPrefix(CO_MANAGED_SEAT_SURFACE)}${'ab'.repeat(32)}`;
const ordinaryKey = 'ab'.repeat(32);
const id = '0b57a1e2-7b41-4c1f-a0d3-1d2e3f4a5b6c';

const request = (method: string, pathname: string, headers: Record<string, string>) => ({
  method,
  nextUrl: { pathname },
  headers: new Headers(headers),
});

const allows = (method: string, path: string) => surfaceAllowsApiRequest(CO_MANAGED_SEAT_SURFACE, method, path);

describe('principal API keys', () => {
  it('names the kind a key was issued under, and nothing for an ordinary key', () => {
    expect(principalKindOfApiKey(seatKey)).toBe('co_managed_seat');
    expect(principalKindOfApiKey(ordinaryKey)).toBeNull();
    expect(principalKindOfApiKey('pk.co_managed_seat.')).toBeNull();
    expect(principalKindOfApiKey(null)).toBeNull();
  });

  it('finds the key in x-api-key or a Bearer header', () => {
    expect(principalKindOfRequest(new Headers({ 'x-api-key': seatKey }))).toBe('co_managed_seat');
    expect(principalKindOfRequest(new Headers({ authorization: `Bearer ${seatKey}` }))).toBe('co_managed_seat');
    expect(principalKindOfRequest(new Headers({ 'x-api-key': ordinaryKey }))).toBeNull();
  });
});

describe('the seat API surface', () => {
  it('opens the operational endpoints the mobile app uses', () => {
    expect(allows('GET', '/api/v1/tickets')).toBe(true);
    expect(allows('POST', '/api/v1/tickets')).toBe(true);
    expect(allows('GET', `/api/v1/tickets/${id}`)).toBe(true);
    expect(allows('PUT', `/api/v1/tickets/${id}/status`)).toBe(true);
    expect(allows('POST', `/api/v1/tickets/${id}/comments`)).toBe(true);
    expect(allows('GET', `/api/v1/projects/${id}/phases/${id}/tasks`)).toBe(true);
    expect(allows('GET', `/api/v1/assets/${id}/software`)).toBe(true);
    expect(allows('GET', '/api/v1/time-entries')).toBe(true);
    expect(allows('GET', '/api/v1/stopwatch/active')).toBe(true);
    expect(allows('GET', `/api/documents/view/${id}`)).toBe(true);
    expect(allows('POST', '/api/v1/mobile/auth/refresh')).toBe(true);
    expect(allows('GET', '/api/v1/mobile/me/capabilities')).toBe(true);
  });

  it('closes the commercial, CRM and administrative endpoints', () => {
    for (const [method, path] of [
      ['GET', '/api/v1/clients'],
      ['GET', `/api/v1/clients/${id}`],
      ['GET', '/api/v1/opportunities'],
      ['GET', '/api/v1/inventory/stock'],
      ['GET', '/api/v1/interactions'],
      ['GET', '/api/v1/users'],
      ['GET', '/api/v1/search'],
      ['GET', '/api/v1/activities'],
      ['GET', '/api/v1/schedules'],
      ['GET', '/api/v1/workflows/tasks'],
      ['GET', '/api/v1/tags/cloud'],
      ['GET', `/api/v1/tags/entity/ticket/${id}`],
      ['GET', '/api/v1/services'],
      ['POST', '/api/v1/api-keys'],
      ['POST', '/api/mcp'],
      ['POST', '/api/v1/mobile/account/delete'],
    ] as const) {
      expect(allows(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it('closes the ticket endpoints the seat rules do not narrow', () => {
    expect(allows('GET', `/api/v1/tickets/${id}/materials`)).toBe(false);
    expect(allows('POST', `/api/v1/tickets/${id}/materials`)).toBe(false);
    expect(allows('POST', `/api/v1/tickets/${id}/assets`)).toBe(false);
    expect(allows('DELETE', `/api/v1/tickets/${id}/documents/${id}`)).toBe(false);
    expect(allows('DELETE', `/api/v1/tickets/${id}`)).toBe(false);
    expect(allows('POST', '/api/v1/tickets/from-asset')).toBe(false);
  });

  it('does not let a wildcard reach the static siblings of a record route', () => {
    for (const path of [
      '/api/v1/tickets/search', '/api/v1/tickets/recurring', '/api/v1/tickets/templates',
      '/api/v1/projects/export', '/api/v1/assets/export', '/api/v1/contacts/export', '/api/v1/contacts/stats',
    ]) {
      expect(allows('GET', path), path).toBe(false);
    }
  });

  it('opens only the own-entry time list: time writes and the (commercial) stopwatch stay closed', () => {
    expect(allows('POST', '/api/v1/time-entries')).toBe(false);
    expect(allows('POST', '/api/v1/stopwatch')).toBe(false);
    expect(allows('POST', `/api/v1/stopwatch/${id}/log`)).toBe(false);
    expect(allows('GET', `/api/v1/time-entries/${id}`)).toBe(false);
    expect(allows('PUT', `/api/v1/time-entries/${id}`)).toBe(false);
    expect(allows('GET', '/api/v1/time-entries/export')).toBe(false);
    expect(allows('POST', '/api/v1/time-entries/approve')).toBe(false);
  });

  it('matches whole segments only, and ignores a trailing slash or query', () => {
    expect(allows('GET', '/api/v1/ticketsX')).toBe(false);
    expect(allows('GET', `/api/v1/tickets/${id}/comments/extra`)).toBe(false);
    expect(allows('GET', '/api/v1/tickets/')).toBe(true);
    expect(allows('GET', '/api/v1/tickets?page=2')).toBe(true);
    expect(allows('HEAD', '/api/v1/tickets')).toBe(false);
  });

  it('is closed for a kind nobody registered', () => {
    expect(surfaceAllowsApiRequest('unknown_kind', 'GET', '/api/v1/tickets')).toBe(false);
  });
});

describe('principalApiSurfaceResponse', () => {
  it('refuses a seat key on a closed route with 403, including routes that skip the edge key check', async () => {
    for (const path of ['/api/v1/clients', '/api/v1/mcp/rpc', '/api/accounting/exports/x', '/api/auth/validate-api-key']) {
      const response = principalApiSurfaceResponse(request('GET', path, { 'x-api-key': seatKey }));
      expect(response?.status, path).toBe(403);
      await expect(response?.json()).resolves.toMatchObject({ error: { code: 'PRINCIPAL_API_ROUTE_CLOSED' } });
    }
  });

  it('refuses a seat key sent as a Bearer token', () => {
    expect(principalApiSurfaceResponse(request('GET', '/api/v1/clients', { authorization: `Bearer ${seatKey}` }))?.status).toBe(403);
  });

  it('lets a seat key through on an open route', () => {
    expect(principalApiSurfaceResponse(request('GET', '/api/v1/tickets', { 'x-api-key': seatKey }))).toBeNull();
  });

  it('leaves ordinary keys, sessions and non-API paths alone', () => {
    expect(principalApiSurfaceResponse(request('GET', '/api/v1/clients', { 'x-api-key': ordinaryKey }))).toBeNull();
    expect(principalApiSurfaceResponse(request('GET', '/api/v1/clients', {}))).toBeNull();
    expect(principalApiSurfaceResponse(request('GET', '/msp/clients', { 'x-api-key': seatKey }))).toBeNull();
  });
});
