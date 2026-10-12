import { describe, expect, it, vi } from 'vitest';
import { UniFiApiError } from '../../../lib/integrations/unifi/unifiApiClient';
import {
  createUniFiAlertFetcher,
  offlineAlertId,
  resolveOfflineGraceMinutes,
} from '../../../lib/integrations/unifi/alerts/reconciliationFetcher';

const NOW = new Date('2026-10-12T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function makeKnex(rows: Record<string, any[]>) {
  const raw = vi.fn(async () => undefined);
  const knex: any = (table: string) => {
    const data = rows[table] ?? [];
    const b: any = {
      where: () => b,
      whereNotNull: () => b,
      andWhere: () => b,
      whereIn: () => b,
      select: async () => data,
      first: async () => data[0],
    };
    return b;
  };
  knex.raw = raw;
  knex.fn = { now: () => NOW };
  return { knex, raw };
}

const SITE = { external_organization_id: 'h:s', external_organization_name: 'HQ', client_id: 'c1' };
const dev = (over: Record<string, unknown> = {}) => ({
  id: 'sw-1', macAddress: 'aa:bb:cc:dd:ee:01', ipAddress: null, name: 'Core', model: 'USW-24',
  serialNumber: null, state: 'OFFLINE', firmwareVersion: null, firmwareUpdatable: false,
  features: ['switching'], uplinkDeviceId: null, stateChangedAt: null, raw: {}, ...over,
});

function setup(opts: { settings?: any; devices?: any[] | Error; open?: any[] }) {
  const { knex, raw } = makeKnex({
    rmm_integrations: [{ settings: opts.settings ?? {} }],
    rmm_organization_mappings: [SITE],
    rmm_alerts: opts.open ?? [],
  });
  const listDevices = vi.fn(async () => {
    if (opts.devices instanceof Error) throw opts.devices;
    return opts.devices ?? [];
  });
  const fetcher = createUniFiAlertFetcher({
    getKnex: async () => knex,
    createClient: async () => ({ listDevices }) as any,
    now: () => NOW,
  });
  return { fetcher, raw, listDevices };
}

const run = (f: ReturnType<typeof createUniFiAlertFetcher>) => f.fetchActiveAlerts({ tenantId: 't', integrationId: 'i' });

describe('unifi offline alert fetcher', () => {
  it('defaults the grace window to 5 minutes', () => {
    expect(resolveOfflineGraceMinutes({})).toBe(5);
    expect(resolveOfflineGraceMinutes({ offlineGraceMinutes: 0 })).toBe(0);
    expect(resolveOfflineGraceMinutes({ offlineGraceMinutes: 'x' })).toBe(5);
  });

  it('does not alert inside the grace window and records a first-observed marker', async () => {
    const { fetcher, raw } = setup({ devices: [dev()] });
    expect(await run(fetcher)).toEqual([]);
    expect(raw).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((raw.mock.calls[0] as any)[1][0]);
    expect(payload).toEqual({ 'sw-1': NOW.toISOString() });
  });

  it('alerts after the grace window using the stored first-observed marker, with severity by kind', async () => {
    const { fetcher } = setup({
      settings: { unifiOfflineObservations: { 'sw-1': minutesAgo(10) } },
      devices: [dev()],
    });
    const [event] = await run(fetcher);
    expect(event.externalAlertId).toBe(offlineAlertId('sw-1', minutesAgo(10)));
    expect(event.severity).toBe('major');
    expect(event.kind).toBe('triggered');
    expect(event.activityType).toBe('DEVICE_OFFLINE');
    expect(event.externalOrganizationId).toBe('h:s');
    expect(event.externalDeviceId).toBe('sw-1');
  });

  it('prefers the API state-change timestamp over a marker', async () => {
    const { fetcher, raw } = setup({ devices: [dev({ stateChangedAt: minutesAgo(30) })] });
    const [event] = await run(fetcher);
    expect(event.occurredAt).toBe(minutesAgo(30));
    expect((event.raw as any).observedVia).toBe('api_timestamp');
    expect(raw).not.toHaveBeenCalled(); // no marker needed
  });

  it('honours a custom grace window', async () => {
    const { fetcher } = setup({
      settings: { offlineGraceMinutes: 60, unifiOfflineObservations: { 'sw-1': minutesAgo(10) } },
      devices: [dev()],
    });
    expect(await run(fetcher)).toEqual([]);
  });

  it('reuses the id of an open alert for the same device instead of minting a new one', async () => {
    const { fetcher } = setup({
      settings: { unifiOfflineObservations: { 'sw-1': minutesAgo(20) } },
      devices: [dev()],
      open: [{ external_device_id: 'sw-1', external_alert_id: 'unifi:offline:sw-1:EARLIER' }],
    });
    const [event] = await run(fetcher);
    expect(event.externalAlertId).toBe('unifi:offline:sw-1:EARLIER');
  });

  it('mints a NEW id for a new outage after the previous alert closed', async () => {
    const { fetcher } = setup({
      settings: { unifiOfflineObservations: { 'sw-1': minutesAgo(8) } },
      devices: [dev()],
      open: [], // earlier outage's row is resolved, so not open
    });
    const [event] = await run(fetcher);
    expect(event.externalAlertId).toBe(offlineAlertId('sw-1', minutesAgo(8)));
    expect(event.externalAlertId).not.toContain('EARLIER');
  });

  it('prunes the marker when the device is back online and emits nothing', async () => {
    const { fetcher, raw } = setup({
      settings: { unifiOfflineObservations: { 'sw-1': minutesAgo(30) } },
      devices: [dev({ state: 'ONLINE' })],
    });
    expect(await run(fetcher)).toEqual([]);
    expect(JSON.parse((raw.mock.calls[0] as any)[1][0])).toEqual({});
  });

  it('keeps an open alert alive (and the marker) while the device is updating', async () => {
    const { fetcher } = setup({
      settings: { unifiOfflineObservations: { 'sw-1': minutesAgo(30) } },
      devices: [dev({ state: 'UPDATING' })],
      open: [{ external_device_id: 'sw-1', external_alert_id: 'unifi:offline:sw-1:X' }],
    });
    const events = await run(fetcher);
    expect(events.map((e) => e.externalAlertId)).toEqual(['unifi:offline:sw-1:X']);
  });

  it('rates gateway critical and access point moderate', async () => {
    const { fetcher } = setup({
      settings: { offlineGraceMinutes: 0 },
      devices: [
        dev({ id: 'gw', model: 'UDM-Pro', features: [] }),
        dev({ id: 'ap', model: 'U6-Pro', features: ['accessPoint'] }),
      ],
    });
    const events = await run(fetcher);
    expect(Object.fromEntries(events.map((e) => [e.externalDeviceId, e.severity]))).toEqual({ gw: 'critical', ap: 'moderate' });
  });

  it('sets per-kind alertClass, unifi_device_state source and device_offline condition', async () => {
    const { fetcher } = setup({
      settings: { offlineGraceMinutes: 0 },
      devices: [
        dev({ id: 'gw', model: 'UDM-Pro', features: [] }),
        dev({ id: 'rt', model: 'UXG-Lite', features: [] }),
        dev({ id: 'sw' }),
        dev({ id: 'ap', model: 'U6-Pro', features: ['accessPoint'] }),
      ],
    });
    const events = await run(fetcher);
    const byId = Object.fromEntries(events.map((e) => [e.externalDeviceId, e]));
    expect(byId.sw.alertClass).toBe('switch');
    expect(byId.ap.alertClass).toBe('access_point');
    expect(['firewall', 'router']).toContain(byId.gw.alertClass);
    for (const e of events) {
      expect(e.sourceType).toBe('unifi_device_state');
      expect(e.conditionIdentity).toBe('device_offline');
      expect(e.activityType).toBe('DEVICE_OFFLINE');
    }
  });

  it('throws on an empty listing for a site with open offline alerts (no resets synthesized)', async () => {
    const { fetcher, raw } = setup({
      devices: [],
      open: [{ external_device_id: 'sw-1', external_alert_id: 'unifi:offline:sw-1:X', external_organization_id: 'h:s' }],
    });
    await expect(run(fetcher)).rejects.toBeInstanceOf(UniFiApiError);
    expect(raw).not.toHaveBeenCalled();
  });

  it('an empty listing with no open alerts is fine', async () => {
    const { fetcher } = setup({ devices: [] });
    expect(await run(fetcher)).toEqual([]);
  });

  it('propagates a per-console 403 (fails closed) without any reconnect write', async () => {
    const { fetcher, raw } = setup({ devices: new UniFiApiError('denied', 'console_forbidden', 403) });
    await expect(run(fetcher)).rejects.toMatchObject({ kind: 'console_forbidden' });
    expect(raw).not.toHaveBeenCalled();
  });

  it('alerts for client-mapped sites regardless of auto_sync_assets (own mapped-site query)', async () => {
    const wheres: any[] = [];
    const { knex } = makeKnex({
      rmm_integrations: [{ settings: { offlineGraceMinutes: 0 } }],
      rmm_organization_mappings: [SITE],
      rmm_alerts: [],
    });
    const wrapped: any = (table: string) => {
      const b = knex(table);
      const orig = b.where;
      b.where = (...a: any[]) => { wheres.push([table, ...a]); return orig(...a); };
      const origAnd = b.andWhere;
      b.andWhere = (...a: any[]) => { wheres.push([table, ...a]); return origAnd(...a); };
      return b;
    };
    wrapped.raw = knex.raw;
    wrapped.fn = knex.fn;
    const fetcher = createUniFiAlertFetcher({
      getKnex: async () => wrapped,
      createClient: async () => ({ listDevices: async () => [dev()] }) as any,
      now: () => NOW,
    });
    const events = await run(fetcher);
    expect(events).toHaveLength(1);
    expect(JSON.stringify(wheres)).not.toContain('auto_sync_assets');
  });

  it('fails closed: a failed listing throws and writes no observations', async () => {
    const { fetcher, raw } = setup({ devices: new UniFiApiError('down', 'http', 503) });
    await expect(run(fetcher)).rejects.toBeInstanceOf(UniFiApiError);
    expect(raw).not.toHaveBeenCalled();
  });
});
