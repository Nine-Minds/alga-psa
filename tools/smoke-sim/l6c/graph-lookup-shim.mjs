// L6c smoke shim (rung c, not committed). Forwards every request to the repo msgraph emulator and
// answers ONLY the call the emulator does not model: GET /v1.0/users/:id/events?$filter=
// singleValueExtendedProperties/Any(ep: ep/id eq '<prop>' and ep/value eq '<op>'), from the
// emulator's own calendar-events state. The emulator does not persist transactionId, so the shim
// reports it from the matching extended property value (real Graph returns the stored transactionId).
import http from 'node:http';
const UP = process.env.UPSTREAM || 'http://127.0.0.1:4586', CONTROL = process.env.CONTROL || 'http://127.0.0.1:9586/control/msgraph';
const PORT = Number(process.env.PORT || 4587);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = req.method === 'GET' && url.pathname.match(/^\/v1\.0\/users\/([^/]+)\/events$/);
  const filter = url.searchParams.get('$filter') || '';
  const f = filter.match(/ep\/id eq '((?:[^']|'')+)' and ep\/value eq '((?:[^']|'')+)'/);
  if (m && f) {
    const user = decodeURIComponent(m[1]), prop = f[1].replace(/''/g, "'"), value = f[2].replace(/''/g, "'");
    const state = await (await fetch(`${CONTROL}/state/calendar-events`)).json();
    const hits = (state.result || []).filter(e => e.organizerUserId === user &&
      (e.singleValueExtendedProperties || []).some(p => p.id === prop && p.value === value));
    console.log(`[shim] lookup user=${user} op=${value} -> ${hits.length}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ value: hits.map(e => ({ id: e.id, transactionId: value, onlineMeeting: e.onlineMeeting })) }));
    return;
  }
  const chunks = []; for await (const c of req) chunks.push(c);
  const up = await fetch(UP + req.url, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== 'host' && k !== 'content-length')),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
  console.log(`[shim] ${req.method} ${url.pathname} -> ${up.status}`);
  res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/json' });
  res.end(Buffer.from(await up.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => console.log(`[shim] listening ${PORT} -> ${UP}`));
