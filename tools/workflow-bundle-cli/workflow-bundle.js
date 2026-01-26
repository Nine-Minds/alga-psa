#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');

const usage = (consoleImpl) => {
  consoleImpl.error(`
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

const request = async ({ method, url, cookie, tenant, body, fetchImpl }) => {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (tenant) headers['x-alga-tenant'] = tenant;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetchImpl(url, {
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

async function runWorkflowBundleCli(argv, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const fsImpl = deps.fsImpl ?? fs;
  const consoleImpl = deps.consoleImpl ?? console;

  const { cmd, args } = parseArgs(argv);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    usage(consoleImpl);
    return { ok: false, code: 'usage' };
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

    const url = `${baseUrl.replace(/\/$/, '')}/api/workflow-definitions/${workflowId}/export`;
    const { text } = await request({ method: 'GET', url, cookie, tenant, fetchImpl });
    fsImpl.writeFileSync(out, text, 'utf8');
    consoleImpl.log(`Wrote ${out}`);
    return { ok: true, command: 'export', out };
  }

  if (cmd === 'import') {
    const file = args.file;
    const force = !!args.force;
    if (!file) throw new Error('Missing --file');

    const bundle = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    const qs = force ? '?force=true' : '';
    const url = `${baseUrl.replace(/\/$/, '')}/api/workflow-definitions/import${qs}`;
    const { text } = await request({ method: 'POST', url, cookie, tenant, body: bundle, fetchImpl });
    consoleImpl.log(text);
    return { ok: true, command: 'import' };
  }

  throw new Error(`Unknown command: ${cmd}`);
}

if (require.main === module) {
  runWorkflowBundleCli(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    if (err.details) console.error(JSON.stringify(err.details, null, 2));
    process.exit(1);
  });
}

module.exports = { runWorkflowBundleCli };
