import { beforeEach, describe, expect, it, vi } from 'vitest';

const { hasPermissionMock } = vi.hoisted(() => ({ hasPermissionMock: vi.fn() }));
vi.mock('./rbac', () => ({ hasPermission: (...args: unknown[]) => hasPermissionMock(...args) }));

import type { NextRequest } from 'next/server';
import {
  checkPermission,
  createErrorResponse,
  createSuccessResponse,
  getAuthenticatedUser,
  requireAuthentication,
  requirePermission,
} from './apiAuth';

const request = (headers: Record<string, string>) => new Request('https://alga.test/api/v1/x', { headers }) as unknown as NextRequest;
const authed = () => request({ 'x-auth-user-id': 'u1', 'x-auth-tenant': 't1' });

beforeEach(() => { hasPermissionMock.mockReset(); });

describe('getAuthenticatedUser', () => {
  it('reads the identity the API-key middleware stamped on the request', () => {
    expect(getAuthenticatedUser(authed())).toEqual({ userId: 'u1', tenant: 't1' });
  });

  it('is null unless both user and tenant headers are present', () => {
    expect(getAuthenticatedUser(request({}))).toBeNull();
    expect(getAuthenticatedUser(request({ 'x-auth-user-id': 'u1' }))).toBeNull();
    expect(getAuthenticatedUser(request({ 'x-auth-tenant': 't1' }))).toBeNull();
    expect(getAuthenticatedUser(request({ 'x-auth-user-id': '', 'x-auth-tenant': 't1' }))).toBeNull();
  });
});

describe('requireAuthentication', () => {
  it('returns the user or throws Unauthorized', () => {
    expect(requireAuthentication(authed())).toEqual({ userId: 'u1', tenant: 't1' });
    expect(() => requireAuthentication(request({}))).toThrow('Unauthorized');
  });
});

describe('checkPermission / requirePermission', () => {
  it('denies without an identity and never consults RBAC', async () => {
    expect(await checkPermission(request({}), 'ticket', 'read')).toBe(false);
    await expect(requirePermission(request({}), 'ticket', 'read')).rejects.toThrow('Forbidden');
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('asks RBAC as an internal user of the request tenant', async () => {
    hasPermissionMock.mockResolvedValue(true);
    expect(await checkPermission(authed(), 'ticket', 'update')).toBe(true);
    const [user, resource, action] = hasPermissionMock.mock.calls[0];
    expect(user).toMatchObject({ user_id: 'u1', tenant: 't1', user_type: 'internal', is_inactive: false });
    expect([resource, action]).toEqual(['ticket', 'update']);
  });

  it('throws Forbidden when RBAC denies', async () => {
    hasPermissionMock.mockResolvedValue(false);
    await expect(requirePermission(authed(), 'invoice', 'delete')).rejects.toThrow('Forbidden');
  });
});

describe('response helpers', () => {
  it('serializes errors as JSON with the given status, defaulting to 400', async () => {
    const res = createErrorResponse('nope');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ error: 'nope' });
    expect(createErrorResponse('gone', 404).status).toBe(404);
  });

  it('serializes success payloads with the given status, defaulting to 200', async () => {
    const res = createSuccessResponse({ id: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 1 });
    expect(createSuccessResponse(null, 201).status).toBe(201);
  });
});
