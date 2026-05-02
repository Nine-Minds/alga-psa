#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.env.ALGA_APPLIANCE_PORT || 8080);
const stateFile = process.env.ALGA_APPLIANCE_STATE_FILE || '/var/lib/alga-appliance/install-state.json';

function currentMode() {
  if (!fs.existsSync(stateFile)) {
    return 'setup';
  }

  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return state.phase === 'complete' ? 'status' : 'setup';
  } catch {
    return 'setup';
  }
}

const server = http.createServer((req, res) => {
  const mode = currentMode();

  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mode }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><body><h1>Alga Appliance ${mode === 'setup' ? 'Setup' : 'Status'}</h1><p>Mode: ${mode}</p></body></html>`);
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`alga-appliance host service listening on :${port}\n`);
});
