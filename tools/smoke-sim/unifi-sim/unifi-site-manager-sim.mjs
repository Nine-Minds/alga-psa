#!/usr/bin/env node
// UniFi Site Manager simulator with fabric-scoped API keys (card fd64fb8d,
// "multiple API keys per integration"; reusable for card c0758497).
//
// It reproduces the behaviour Ryan at Tom's Help Desk diagnosed:
//   - a key created under "Independent" lists EVERY console through /v1/hosts,
//     but the Cloud Connector answers 403 for consoles that sit inside a fabric;
//   - a key created under a fabric lists, and reaches, only that fabric's consoles;
//   - an unknown or revoked key gets 401.
//
// Point AlgaPSA at it with UNIFI_SITE_MANAGER_BASE_URL=http://<SIM_HOST>:<SIM_PORT>.
//
// API (X-API-KEY required):
//   GET /v1/hosts?pageSize&nextToken
//   GET /v1/connector/consoles/:hostId/proxy/network/integration/v1/sites?offset&limit
//   GET /v1/connector/consoles/:hostId/proxy/network/integration/v1/sites/:siteId/devices[/:deviceId]
// Control plane (no auth):
//   GET  /__sim/state                      consoles, fabrics, key scopes (key values masked)
//   GET  /__sim/log                        last 300 requests: key LABEL, path, status (never key values)
//   POST /__sim/key    {key:"independent"|"north"|"south", revoked:true|false}
//   POST /__sim/device {hostId, siteId, id, state}
//   POST /__sim/reset                      restore the initial state and clear the log
//
// Usage: SIM_HOST=0.0.0.0 SIM_PORT=18795 node unifi-site-manager-sim.mjs
// The keys below are simulator test values, not secrets.
import http from 'node:http';

const HOST = process.env.SIM_HOST || '0.0.0.0';
const PORT = Number(process.env.SIM_PORT || 18795);

const KEYS = {
  independent: process.env.SIM_KEY_INDEPENDENT || 'sim-sm-independent-key',
  north: process.env.SIM_KEY_NORTH || 'sim-sm-fabric-north-key',
  south: process.env.SIM_KEY_SOUTH || 'sim-sm-fabric-south-key',
};

function initialConsoles() {
  return {
    'host-indep-emerald': {
      name: 'Emerald City Gateway',
      fabric: null,
      sites: {
        'site-ec-001': {
          name: 'Emerald City Office',
          devices: [
            { id: 'sm-ec-gw', name: 'EC Gateway', model: 'UDM-Pro', macAddress: '74:AC:B9:10:00:01', ipAddress: '10.30.0.1', state: 'ONLINE', firmwareVersion: '4.0.6', features: ['gateway'] },
            { id: 'sm-ec-ap', name: 'EC Lobby AP', model: 'U6-Pro', macAddress: '74:AC:B9:10:00:02', ipAddress: '10.30.0.2', state: 'ONLINE', firmwareVersion: '6.6.77', features: ['accessPoint'], uplink: { deviceId: 'sm-ec-gw' } },
          ],
        },
      },
    },
    'host-fab-north-01': {
      name: 'Gillikin Fabric Console',
      fabric: 'north',
      sites: {
        'site-gk-001': {
          name: 'Gillikin Tower',
          devices: [
            { id: 'sm-gk-gw', name: 'Gillikin Gateway', model: 'UXG-Pro', macAddress: '74:AC:B9:20:00:01', ipAddress: '10.40.0.1', state: 'ONLINE', firmwareVersion: '4.0.6', features: ['gateway'] },
            { id: 'sm-gk-sw', name: 'Gillikin Core Switch', model: 'USW-Pro-48-PoE', macAddress: '74:AC:B9:20:00:02', ipAddress: '10.40.0.2', state: 'ONLINE', firmwareVersion: '7.1.26', features: ['switching'], uplink: { deviceId: 'sm-gk-gw' } },
          ],
        },
      },
    },
    'host-fab-south-01': {
      name: 'Quadling Fabric Console',
      fabric: 'south',
      sites: {
        'site-qd-001': {
          name: 'Quadling Clinic',
          devices: [
            { id: 'sm-qd-gw', name: 'Quadling Gateway', model: 'UDR', macAddress: '74:AC:B9:30:00:01', ipAddress: '10.50.0.1', state: 'ONLINE', firmwareVersion: '4.0.6', features: ['gateway'] },
          ],
        },
      },
    },
  };
}

let consoles = initialConsoles();
const revoked = new Set();
let log = [];

/** Which consoles a key lists, and which it can reach through the connector. */
function scopeOf(label) {
  if (label === 'independent') {
    return { lists: Object.keys(consoles), reaches: Object.keys(consoles).filter((h) => !consoles[h].fabric) };
  }
  const inFabric = Object.keys(consoles).filter((h) => consoles[h].fabric === label);
  return { lists: inFabric, reaches: inFabric };
}

function labelForKey(value) {
  return Object.keys(KEYS).find((label) => KEYS[label] === value) ?? null;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
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

function integrationPage(items, url) {
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 25);
  const data = items.slice(offset, offset + limit);
  return { offset, limit, count: data.length, totalCount: items.length, data };
}

function record(entry) {
  log.push({ at: new Date().toISOString(), ...entry });
  if (log.length > 300) log = log.slice(-300);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'sim'}`);
  const path = url.pathname;

  if (path.startsWith('/__sim/')) {
    if (path === '/__sim/state') {
      return send(res, 200, {
        consoles,
        keys: Object.fromEntries(
          Object.keys(KEYS).map((label) => [label, { masked: `${KEYS[label].slice(0, 7)}…`, revoked: revoked.has(label), ...scopeOf(label) }])
        ),
      });
    }
    if (path === '/__sim/log') return send(res, 200, log);
    const body = await readBody(req);
    if (path === '/__sim/reset') {
      consoles = initialConsoles();
      revoked.clear();
      log = [];
      return send(res, 200, { reset: true });
    }
    if (path === '/__sim/key') {
      if (!(body.key in KEYS)) return send(res, 404, { error: 'unknown key label' });
      if (body.revoked) revoked.add(body.key); else revoked.delete(body.key);
      return send(res, 200, { key: body.key, revoked: revoked.has(body.key) });
    }
    if (path === '/__sim/device') {
      const site = consoles[body.hostId]?.sites?.[body.siteId];
      const dev = site?.devices.find((d) => d.id === body.id);
      if (!dev) return send(res, 404, { error: 'no such device' });
      if (body.state) dev.state = body.state;
      dev.lastStateChangeAt = new Date().toISOString();
      return send(res, 200, dev);
    }
    return send(res, 404, { error: 'unknown sim route' });
  }

  const label = labelForKey(req.headers['x-api-key']);
  const reply = (status, payload) => {
    record({ key: label ?? 'unknown', method: req.method, path: path + url.search, status });
    return send(res, status, payload);
  };

  if (!label || revoked.has(label)) {
    return reply(401, { code: 'api.authentication.missing-credentials', message: 'Unauthorized' });
  }
  const scope = scopeOf(label);

  if (path === '/v1/hosts') {
    const data = scope.lists.map((hostId) => ({
      id: hostId,
      type: 'console',
      reportedState: { name: consoles[hostId].name, state: 'connected' },
    }));
    return reply(200, { data, httpStatusCode: 200, traceId: 'sim' });
  }

  const match = path.match(/^\/v1\/connector\/consoles\/([^/]+)\/proxy\/network\/integration\/v1(\/.*)$/);
  if (!match) return reply(404, { message: 'not found' });
  const hostId = decodeURIComponent(match[1]);
  const console = consoles[hostId];
  if (!console) return reply(404, { message: 'console not found' });
  if (!scope.reaches.includes(hostId)) {
    // What the real Cloud Connector does for a fabric console and an Independent key.
    return reply(403, { code: 'api.connector.forbidden', message: 'Forbidden' });
  }

  const rest = match[2].split('/').filter(Boolean).map(decodeURIComponent);
  if (rest.length === 1 && rest[0] === 'sites') {
    const sites = Object.entries(console.sites).map(([id, s]) => ({ id, name: s.name, internalReference: id }));
    return reply(200, integrationPage(sites, url));
  }
  if (rest[0] === 'sites' && rest[2] === 'devices') {
    const site = console.sites[rest[1]];
    if (!site) return reply(404, { message: 'site not found' });
    if (rest.length === 3) return reply(200, integrationPage(site.devices, url));
    const dev = site.devices.find((d) => d.id === rest[3]);
    return dev ? reply(200, dev) : reply(404, { message: 'device not found' });
  }
  return reply(404, { message: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`unifi-site-manager-sim listening on http://${HOST}:${PORT}`);
  console.log('keys (simulator test values): ' + Object.entries(KEYS).map(([l, k]) => `${l}=${k}`).join(' '));
});
