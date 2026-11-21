// Minimal trusted-IdP + MCP agent client simulator for the "audience required"
// smoke test. Serves two issuers (one per path prefix) sharing one RSA key, a
// JWKS, and a console page whose buttons mint a JWT with a chosen `aud` and
// POST it as a Bearer to the app's real /api/mcp (server-side, no CORS).
import http from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const PORT = Number(process.env.PORT || 4795);
const APP_URL = process.env.APP_URL || 'http://localhost:3036';
const BASE = `http://localhost:${PORT}`;
const ISSUERS = { good: `${BASE}/good`, legacy: `${BASE}/legacy` };
const EXPECTED_AUD = process.env.EXPECTED_AUD || 'https://alga-smoke/api/mcp';
const SUBJECT = { good: 'aud-smoke-agent-good', legacy: 'aud-smoke-agent-legacy' };

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'smoke-1', alg: 'RS256', use: 'sig' };

const CASES = {
  'A-good-correct-aud': { iss: 'good', aud: EXPECTED_AUD, expect: '200 (provider audience matches)' },
  'B-good-foreign-aud': { iss: 'good', aud: 'some-other-app', expect: '403 (token issued for another app)' },
  'C-legacy-null-aud': { iss: 'legacy', aud: 'some-other-app', expect: '403 "no audience configured" (was 200 before the fix)' },
  'D-legacy-any-aud': { iss: 'legacy', aud: EXPECTED_AUD, expect: '403 "no audience configured" (row has no audience at all)' },
};

async function runCase(id) {
  const c = CASES[id];
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'smoke-1' })
    .setIssuer(ISSUERS[c.iss]).setSubject(SUBJECT[c.iss]).setAudience(c.aud)
    .setIssuedAt().setExpirationTime('10m').sign(privateKey);
  const res = await fetch(`${APP_URL}/api/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aud-smoke', version: '1' } } }),
  });
  const text = await res.text();
  return { id, issuer: ISSUERS[c.iss], subject: SUBJECT[c.iss], aud: c.aud, expect: c.expect, status: res.status, body: text.slice(0, 400) };
}

const page = () => `<!doctype html><html><head><meta charset="utf-8"><title>MCP agent IdP simulator (audience)</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;max-width:1100px;color:#1d2433}td{border-bottom:1px solid #e3e6ee;padding:8px;vertical-align:top}
table{border-collapse:collapse;width:100%}button{padding:6px 12px;border:1px solid #5b4bd6;background:#6d5ce8;color:#fff;border-radius:6px;cursor:pointer}
code{background:#f3f4f8;padding:1px 4px;border-radius:4px}.s2{color:#137333;font-weight:700}.s4{color:#b3261e;font-weight:700}pre{white-space:pre-wrap;margin:4px 0;font-size:12px}</style></head>
<body><h1>MCP agent IdP simulator — audience checks</h1>
<p>Issuers: <code>${ISSUERS.good}</code> (registered with audience <code>${EXPECTED_AUD}</code>) and <code>${ISSUERS.legacy}</code> (legacy row, audience NULL). Each button signs a JWT and POSTs <code>initialize</code> to <code>${APP_URL}/api/mcp</code>.</p>
<table>${Object.entries(CASES).map(([id, c]) => `<tr><td><button id="run-${id}" onclick="run('${id}')">${id}</button></td><td>iss <code>${ISSUERS[c.iss]}</code><br>aud <code>${c.aud}</code><br>expect: ${c.expect}</td><td id="out-${id}">—</td></tr>`).join('')}</table>
<script>async function run(id){const o=document.getElementById('out-'+id);o.textContent='…';const r=await (await fetch('/run/'+id,{method:'POST'})).json();
o.innerHTML='<span class="'+(r.status<300?'s2':'s4')+'">HTTP '+r.status+'</span><pre></pre>';o.querySelector('pre').textContent=r.body;}</script></body></html>`;

http.createServer(async (req, res) => {
  console.log(new Date().toISOString(), req.method, req.url);
  try {
    if (req.url.endsWith('/jwks')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    const m = req.url.match(/^\/run\/([\w-]+)$/);
    if (m && CASES[m[1]]) {
      const out = await runCase(m[1]);
      console.log(JSON.stringify(out));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(out));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page());
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 500, body: String(e) }));
  }
}).listen(PORT, () => console.log(`agent-idp-aud-sim on ${PORT}; issuers ${JSON.stringify(ISSUERS)}; app ${APP_URL}`));
