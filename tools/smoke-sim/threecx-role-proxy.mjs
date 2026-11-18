// Smoke-only: sits in front of the 3CX emulator (packages/emulators/threecx) and
// answers 403 for chosen XAPI resources, the way a real PBX does when the API
// app authenticates but its role lacks rights (Gate House IT: /Defs ok, /Users
// and /Contacts 403). Everything else is forwarded untouched.
//
//   UPSTREAM=http://127.0.0.1:4570 PORT=4571 node tools/smoke-sim/threecx-role-proxy.mjs
//   curl -X POST 'localhost:4571/__sim/deny?resources=Users,Contacts'   # arm
//   curl -X POST 'localhost:4571/__sim/deny?resources='                 # disarm
import http from 'node:http';

const upstream = new URL(process.env.UPSTREAM ?? 'http://127.0.0.1:4570');
const port = Number(process.env.PORT ?? 4571);
let denied = new Set();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__sim/deny') {
    if (req.method === 'POST') {
      denied = new Set((url.searchParams.get('resources') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ denied: [...denied] }));
    return;
  }
  const resource = /^\/xapi\/v1\/([A-Za-z]+)/.exec(url.pathname)?.[1];
  if (resource && denied.has(resource)) {
    console.log(`[role-proxy] 403 ${req.method} ${req.url}`);
    req.resume();
    res.writeHead(403, { 'content-type': 'application/json' });
    // Includes a credential-shaped field so the smoke can check log redaction.
    res.end(JSON.stringify({
      error: { code: 'Forbidden', message: `Access denied: role lacks rights on ${resource}` },
      access_token: 'eyJhbGciOiJIUzI1NiJ9.c21va2Utc2VjcmV0.c2ln',
    }));
    return;
  }
  const proxied = http.request(
    { host: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: { ...req.headers, host: upstream.host } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  proxied.on('error', (error) => {
    res.writeHead(502);
    res.end(String(error));
  });
  req.pipe(proxied);
});

server.listen(port, () => console.log(`[role-proxy] :${port} -> ${upstream.href}`));
