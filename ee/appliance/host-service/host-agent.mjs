#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const socketPath = process.env.ALGA_HOST_AGENT_SOCKET || '/run/alga-appliance/host-agent.sock';
const socketGid = Number(process.env.ALGA_HOST_AGENT_SOCKET_GID || 10001);
const commandTimeoutMs = Number(process.env.ALGA_HOST_AGENT_COMMAND_TIMEOUT_MS || 20000);

function redactText(value) {
  return String(value)
    .replace(/((?:token|password|secret|client[-_]?key(?:-data)?|authorization)\s*[:=]\s*)([^\s"']+)/ig, '$1[REDACTED]')
    .replace(/("(?:[^"]*(?:token|password|secret|clientKey|client-key-data)[^"]*)"\s*:\s*")([^"]+)(")/ig, '$1[REDACTED]$3')
    .replace(/(authorization\s*:\s*bearer\s+)([^\s"']+)/ig, '$1[REDACTED]')
    .replace(/(kind:\s*Secret[\s\S]*?\ndata:\n)([\s\S]*?)(\n(?:---|apiVersion:|kind:|metadata:)|$)/ig, '$1  [REDACTED_SECRET_DATA]: [REDACTED]$3');
}

function runCapture(command) {
  const result = spawnSync('sh', ['-c', command], {
    encoding: 'utf8',
    timeout: commandTimeoutMs,
    env: process.env
  });
  const output = [`$ ${command}`, '', result.stdout || '', result.stderr || ''].filter(Boolean).join('\n').trim();
  return {
    ok: result.status === 0 && !result.error,
    status: result.status === null ? (result.error ? 124 : 1) : result.status,
    content: redactText(output || `$ ${command}\n(no output)`)
  };
}

function supportBundlePayload() {
  const captures = [
    ['host/appliance-journal.txt', 'journalctl -u alga-appliance-bootstrap.service -u alga-appliance.service -u alga-appliance-console.service -u k3s -n 1000 --no-pager'],
    ['host/k3s-service-status.txt', 'systemctl status k3s --no-pager'],
    ['host/appliance-bootstrap-status.txt', 'systemctl status alga-appliance-bootstrap.service --no-pager'],
    ['host/appliance-console-status.txt', 'systemctl status alga-appliance-console.service --no-pager'],
    ['host/disk-usage.txt', 'df -h'],
    ['host/ip-addresses.txt', 'ip addr'],
    ['host/routes.txt', 'ip route'],
    ['host/resolv-conf.txt', 'cat /etc/resolv.conf'],
    ['host/dns-lookup-github.txt', 'getent hosts raw.githubusercontent.com'],
    ['host/dns-lookup-ghcr.txt', 'getent hosts ghcr.io'],
    ['host/https-github.txt', 'curl -I --max-time 10 https://raw.githubusercontent.com'],
    ['host/https-ghcr.txt', 'curl -I --max-time 10 https://ghcr.io/v2/']
  ];

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    agent: 'alga-host-agent',
    files: captures.map(([filePath, command]) => Object.assign({
      path: filePath
    }, runCapture(command)))
  };
}

function json(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(body)}\n`);
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/health') {
    json(res, 200, { ok: true, service: 'alga-host-agent' });
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/support-bundle') {
    json(res, 200, supportBundlePayload());
    return;
  }

  json(res, 404, { ok: false, error: 'not found' });
});

fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o755 });
try {
  fs.unlinkSync(socketPath);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o660);
  try {
    fs.chownSync(socketPath, 0, socketGid);
  } catch {
    // Best effort. Socket mode still limits access according to host ownership.
  }
  // eslint-disable-next-line no-console
  console.log(`alga-host-agent listening on ${socketPath}`);
});

function shutdown() {
  server.close(() => {
    try { fs.unlinkSync(socketPath); } catch {}
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
