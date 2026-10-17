#!/usr/bin/env node
// Minimal UniFi Network Integration API simulator (local-controller mode) for
// smoke testing alga-2026-0002579. Serves the shapes unifiApiClient.ts expects:
//   GET /proxy/network/integration/v1/sites?offset&limit
//   GET /proxy/network/integration/v1/sites/:siteId/devices?offset&limit
//   GET /proxy/network/integration/v1/sites/:siteId/devices/:deviceId
// Auth: X-API-KEY must equal SIM_API_KEY (else 401).
// Control plane (no auth): GET /__sim/state, POST /__sim/device {siteId,id,state?,lastStateChangeAt?,remove?},
//   POST /__sim/mode {siteId, mode: normal|empty|forbidden|error500}, GET /__sim/log
// Usage: SIM_HOST=172.17.0.1 SIM_PORT=18794 SIM_API_KEY=... node unifi-controller-sim.mjs
import http from 'node:http';

const HOST = process.env.SIM_HOST || '172.17.0.1';
const PORT = Number(process.env.SIM_PORT || 18794);
const API_KEY = process.env.SIM_API_KEY || 'sim-unifi-key-0002579';

const sites = {
  'site-hq-0001': {
    id: 'site-hq-0001',
    name: 'Emerald HQ',
    mode: 'normal',
    devices: [
      { id: 'dev-gw-0001', name: 'HQ Gateway', model: 'UDM-Pro', macAddress: '74:AC:B9:00:00:01', ipAddress: '10.10.0.1', state: 'ONLINE', firmwareVersion: '4.0.6', firmwareUpdatable: false, features: ['gateway'], serialNumber: 'SIMGW0001' },
      { id: 'dev-sw-0001', name: 'HQ Core Switch', model: 'USW-Pro-24-PoE', macAddress: '74:AC:B9:00:00:02', ipAddress: '10.10.0.2', state: 'ONLINE', firmwareVersion: '7.1.26', firmwareUpdatable: true, features: ['switching'], uplink: { deviceId: 'dev-gw-0001' } },
      { id: 'dev-ap-0001', name: 'HQ Lobby AP', model: 'U6-Pro', macAddress: '74:AC:B9:00:00:03', ipAddress: '10.10.0.3', state: 'ONLINE', firmwareVersion: '6.6.77', firmwareUpdatable: false, features: ['accessPoint'], uplink: { deviceId: 'dev-sw-0001' } },
      { id: 'dev-cam-0001', name: 'HQ Door Camera', model: 'G4-Doorbell', macAddress: '74:AC:B9:00:00:04', ipAddress: '10.10.0.4', state: 'ONLINE', features: [] },
    ],
  },
  'site-br-0002': {
    id: 'site-br-0002',
    name: 'Munchkinland Branch',
    mode: 'normal',
    devices: [
      { id: 'dev-gw-0002', name: 'Branch Gateway', model: 'UDR', macAddress: '74:AC:B9:00:01:01', ipAddress: '10.20.0.1', state: 'ONLINE', firmwareVersion: '4.0.6', features: ['gateway'] },
    ],
  },
};

const log = [];

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function page(items, url) {
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 25);
  const data = items.slice(offset, offset + limit);
  return { offset, limit, count: data.length, totalCount: items.length, data };
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (path.startsWith('/__sim/')) {
    if (path === '/__sim/state') return send(res, 200, sites);
    if (path === '/__sim/log') return send(res, 200, log.slice(-200));
    const body = await readBody(req);
    if (path === '/__sim/device') {
      const site = sites[body.siteId];
      const dev = site?.devices.find((d) => d.id === body.id);
      if (!dev) return send(res, 404, { error: 'no such device' });
      if (body.remove) {
        site.devices = site.devices.filter((d) => d !== dev);
        return send(res, 200, { removed: dev.id });
      }
      if (body.state) dev.state = body.state;
      if ('lastStateChangeAt' in body) dev.lastStateChangeAt = body.lastStateChangeAt;
      return send(res, 200, dev);
    }
    if (path === '/__sim/mode') {
      const site = sites[body.siteId];
      if (!site) return send(res, 404, { error: 'no such site' });
      site.mode = body.mode || 'normal';
      return send(res, 200, { siteId: site.id, mode: site.mode });
    }
    return send(res, 404, { error: 'unknown sim route' });
  }

  const key = req.headers['x-api-key'];
  log.push({ at: new Date().toISOString(), method: req.method, path: url.pathname + url.search, keyOk: key === API_KEY });
  if (key !== API_KEY) return send(res, 401, { code: 'api.authentication.missing-credentials', message: 'Unauthorized' });

  const prefix = '/proxy/network/integration/v1';
  if (!path.startsWith(prefix)) return send(res, 404, { message: 'not found' });
  const rest = path.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent);

  if (rest.length === 1 && rest[0] === 'sites') {
    return send(res, 200, page(Object.values(sites).map((s) => ({ id: s.id, name: s.name, internalReference: s.id })), url));
  }
  if (rest[0] === 'sites' && rest[2] === 'devices') {
    const site = sites[rest[1]];
    if (!site) return send(res, 404, { message: 'site not found' });
    if (site.mode === 'forbidden') return send(res, 403, { message: 'Forbidden' });
    if (site.mode === 'error500') return send(res, 500, { message: 'controller error' });
    const devices = site.mode === 'empty' ? [] : site.devices;
    if (rest.length === 3) return send(res, 200, page(devices, url));
    const dev = devices.find((d) => d.id === rest[3]);
    return dev ? send(res, 200, dev) : send(res, 404, { message: 'device not found' });
  }
  return send(res, 404, { message: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`unifi-controller-sim listening on http://${HOST}:${PORT} (key=${API_KEY.slice(0, 4)}…)`);
});
