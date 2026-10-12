import { describe, expect, it, vi } from 'vitest';

const raw = vi.fn(async () => undefined);
vi.mock('@alga-psa/db/admin.js', () => ({ getAdminConnection: async () => ({ raw }) }));

import { markUniFiReconnectRequired } from '../../../lib/integrations/unifi/reconnect';

describe('markUniFiReconnectRequired', () => {
  it('issues one atomic jsonb merge scoped by tenant and provider (no read-modify-write)', async () => {
    await markUniFiReconnectRequired('tenant-1');
    expect(raw).toHaveBeenCalledTimes(1);
    const [sql, bindings] = raw.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/UPDATE rmm_integrations/);
    expect(sql).toMatch(/settings\s*=\s*COALESCE\(settings, '\{\}'::jsonb\)\s*\|\|/);
    expect(sql).toContain('jsonb_build_object');
    expect(sql).toMatch(/WHERE tenant = \? AND provider = \?/);
    expect(sql).not.toMatch(/unifiOfflineObservations/);
    expect(bindings.slice(1)).toEqual(['tenant-1', 'unifi']);
  });
});
