// Minimal NinjaOne API simulator for smoke-testing alga0002047.
// Modes (POST /control/mode?m=...):
//   ok       - GET /api/v2/alerts returns one alert, other GETs return []
//   flip401  - on the next API call, mark the integration reconnect_required in
//              the DB (what a concurrent invalid_grant refresh would do), then 401
//   fail500  - every API call returns 500 (a genuine provider failure)
// GET /control/requests returns the request log; POST /control/reset clears it.
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const port = Number(process.env.PORT || 47731);
const psql = process.env.PSQL || '/tmp/a2047-psql.sh';
const tenant = process.env.TENANT;
const integrationId = process.env.INTEGRATION_ID;
let mode = 'ok';
let requests = [];

function flipReconnectRequired() {
  const sql = `update rmm_integrations set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{tokenLifecycle}',
    '{"status":"reconnect_required","reconnectRequired":true,"reconnectReason":"invalid_grant"}'::jsonb)
    where tenant='${tenant}' and integration_id='${integrationId}'`;
  execFileSync(psql, ['-Atc', sql], { stdio: 'inherit' });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname.startsWith('/control/')) {
    if (url.pathname === '/control/mode') { mode = url.searchParams.get('m') || 'ok'; return send(200, { mode }); }
    if (url.pathname === '/control/reset') { requests = []; return send(200, { ok: true }); }
    if (url.pathname === '/control/requests') return send(200, { mode, requests });
    return send(404, {});
  }
  const entry = { at: new Date().toISOString(), method: req.method, path: url.pathname, mode };
  requests.push(entry);
  console.log('[ninjaone-sim]', JSON.stringify(entry));
  if (mode === 'flip401') {
    flipReconnectRequired();
    mode = 'ok';
    return send(401, { error: 'invalid_token' });
  }
  if (mode === 'fail500') return send(500, { error: 'simulated provider outage' });
  if (url.pathname === '/api/v2/alerts') {
    return send(200, [{
      uid: 'sim-alert-1', deviceId: 9001, severity: 'MAJOR', sourceType: 'CONDITION',
      sourceName: 'Disk space low', message: 'C: below 5% free', createTime: Math.floor(Date.now() / 1000),
    }]);
  }
  if (url.pathname === '/oauth/token') return send(400, { error: 'invalid_grant' });
  return send(200, []);
}).listen(port, '127.0.0.1', () => console.log(`[ninjaone-sim] listening on ${port}`));
