#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');

const usage = () => {
  console.error(`
Usage:
  workflow-bundle export --base-url <url> --workflow-id <uuid> --out <file> [--tenant <tenantId>] [--cookie <cookieHeader>]
  workflow-bundle import --base-url <url> --file <workflow-bundle.json> [--force] [--tenant <tenantId>] [--cookie <cookieHeader>]

Notes:
  - --cookie should be the raw Cookie header value (e.g. "next-auth.session-token=...").
  - --tenant sets "x-alga-tenant" to select a tenant context.
`);
};

const parseArgs = (argv) => {
  const [cmd, ...rest] = argv;
  const args = { _: [] };
  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      if (key === 'force') {
        args.force = true;
        i += 1;
        continue;
      }
      const value = rest[i + 1];
      if (value === undefined) throw new Error(`Missing value for --${key}`);
      args[key] = value;
      i += 2;
      continue;
    }
    args._.push(token);
    i += 1;
  }
  return { cmd, args };
};

const request = async ({ method, url, cookie, tenant, body }) => {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (tenant) headers['x-alga-tenant'] = tenant;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  if (!res.ok) {
    let details = null;
    try {
      details = JSON.parse(text);
    } catch {
      details = { error: text };
    }
    const err = new Error(`HTTP ${res.status}: ${details?.error ?? 'Request failed'}`);
    err.details = details;
    err.status = res.status;
    throw err;
  }
  return { res, text };
};

async function main() {
  const { cmd, args } = parseArgs(process.argv.slice(2));
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(1);
  }

  const baseUrl = args['base-url'];
  const tenant = args.tenant;
  const cookie = args.cookie;
  if (!baseUrl) throw new Error('Missing --base-url');

  if (cmd === 'export') {
    const workflowId = args['workflow-id'];
    const out = args.out;
    if (!workflowId) throw new Error('Missing --workflow-id');
    if (!out) throw new Error('Missing --out');

    const url = `${baseUrl.replace(/\\/$/, '')}/api/workflow-definitions/${workflowId}/export`;
    const { text } = await request({ method: 'GET', url, cookie, tenant });
    fs.writeFileSync(out, text, 'utf8');
    console.log(`Wrote ${out}`);
    return;
  }

  if (cmd === 'import') {
    const file = args.file;
    const force = !!args.force;
    if (!file) throw new Error('Missing --file');

    const bundle = JSON.parse(fs.readFileSync(file, 'utf8'));
    const qs = force ? '?force=true' : '';
    const url = `${baseUrl.replace(/\\/$/, '')}/api/workflow-definitions/import${qs}`;
    const { text } = await request({ method: 'POST', url, cookie, tenant, body: bundle });
    console.log(text);
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(err.message);
  if (err.details) console.error(JSON.stringify(err.details, null, 2));
  process.exit(1);
});

