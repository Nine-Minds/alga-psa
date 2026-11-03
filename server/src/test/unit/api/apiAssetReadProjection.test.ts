import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ decision: { allowed: true, redactedFields: [] as string[] }, asset: null as Record<string, any> | null }));
vi.mock('@/lib/api/utils/requestContext', () => ({ requireRequestContext: vi.fn(() => ({ tenant: 'tenant-1', user: { user_id: 'u1' } })) }));
vi.mock('@/lib/productAccess', () => ({ getTenantProduct: vi.fn(async () => 'psa'), ProductAccessError: class extends Error {} }));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: vi.fn(() => 'allowed') }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/api/controllers/authorizationKernel', () => ({ authorizeApiResourceRead: vi.fn(async () => state.decision) }));
vi.mock('@/lib/api/services/AssetService', () => ({ AssetService: class { getAuthorizationRecord = async () => state.asset; getWithDetails = async () => state.asset; } }));

import { ApiAssetController } from '@/lib/api/controllers/ApiAssetController';
const request = () => new NextRequest('http://localhost/api/v2/assets/a1');
const row = () => ({ asset_id: 'a1', asset_tag: 'A-1', client_id: 'c1', client_name: 'Secret client', created_at: new Date('2026-01-02T03:04:05.000Z') });

beforeEach(() => {
  state.asset = row();
  state.decision = { allowed: true, redactedFields: ['assets.client_name'] };
});

describe('asset get response projection', () => {
  it('applies authorization redactions and preserves Date JSON serialization', async () => {
    const response = await new ApiAssetController().getById(request(), { id: 'a1' });
    const body = await response.json();
    expect(body.data).not.toHaveProperty('client_name');
    expect(body.data.created_at).toBe('2026-01-02T03:04:05.000Z');
  });

  it('hides the whole response when the identifier is redacted', async () => {
    state.decision = { allowed: true, redactedFields: ['values.asset_id'] };
    const response = await new ApiAssetController().getById(request(), { id: 'a1' });
    expect(response.status).toBe(404);
  });

  it('hides related and derived asset values when their source fields are redacted', async () => {
    state.asset = {
      ...row(), client: { client_id: 'c1', client_name: 'Secret client' },
      vendor_id: 'v1', vendor_name: 'Secret vendor', contact_name_id: 'contact-1', contact_name: 'Secret contact',
      warranty_end_date: '2020-01-01', warranty_status: 'expired',
    };
    state.decision = { allowed: true, redactedFields: ['assets.client_id', 'assets.vendor_id', 'values.contact_name_id', 'assets.warranty_end_date'] };
    const response = await new ApiAssetController().getById(request(), { id: 'a1' });
    const { data } = await response.json();
    for (const field of ['client', 'client_name', 'vendor_name', 'contact_name', 'warranty_status']) {
      expect(data).not.toHaveProperty(field);
    }
  });
});
