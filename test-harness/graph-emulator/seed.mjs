#!/usr/bin/env node
/**
 * Point a running emulator at a fresh MSP directory and register the OAuth
 * client Alga will present, then print the environment Alga needs.
 *
 * Usage:
 *   node seed.mjs [--url=http://127.0.0.1:4010] [--client-id=alga-dev]
 *                 [--client-secret=alga-dev-secret] [--cipp-key=cipp-dev-key]
 */

function arg(name, fallback) {
  const match = process.argv.slice(2).find((entry) => entry.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : fallback;
}

const url = arg('url', process.env.GRAPH_EMULATOR_URL || 'http://127.0.0.1:4010').replace(/\/+$/, '');
const clientId = arg('client-id', process.env.MICROSOFT_CLIENT_ID || 'alga-dev');
const clientSecret = arg('client-secret', process.env.MICROSOFT_CLIENT_SECRET || 'alga-dev-secret');
const cippKey = arg('cipp-key', process.env.CIPP_API_KEY || '');

async function post(path, body) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const summary = await post('/__control/entra/seed');
await post('/__control/clients', { clientId, clientSecret });
if (cippKey) {
  await post('/__control/entra/cipp-key', { apiKey: cippKey });
}

console.log(`Seeded ${summary.tenants.length} managed tenants and ${summary.userCount} users at ${url}`);
for (const tenant of summary.tenants) {
  console.log(`  ${tenant.displayName.padEnd(22)} ${String(tenant.defaultDomainName).padEnd(24)} ${tenant.userCount} users`);
}

console.log(`
Point Alga at it:

  MICROSOFT_LOGIN_BASE_URL=${url}
  MICROSOFT_GRAPH_BASE_URL=${url}/v1.0
  MICROSOFT_CLIENT_ID=${clientId}
  MICROSOFT_CLIENT_SECRET=${clientSecret}

Then connect with Direct. For the CIPP path, use these in the CIPP dialog:

  CIPP API URL: ${url}
  API key:      ${cippKey || 'any non-empty value (no key pinned)'}
`);
