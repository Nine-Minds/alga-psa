#!/usr/bin/env node
/**
 * List Microsoft Graph subscriptions (webhooks) via REST
 *
 * Supports two auth modes:
 * 1) Delegated: provide ACCESS_TOKEN env (e.g., from OAuth callback) — best for /me mail subscriptions
 * 2) App-only (client credentials): MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
 *
 * Falls back to reading secrets from ./secrets/ files if env vars are missing:
 * - secrets/MICROSOFT_TENANT_ID
 * - secrets/MICROSOFT_CLIENT_ID
 * - secrets/MICROSOFT_CLIENT_SECRET
 *
 * Usage:
 *   node scripts/ms-graph-list-subscriptions.js
 *   node scripts/ms-graph-list-subscriptions.js --id <subscriptionId>
 *   ACCESS_TOKEN=... node scripts/ms-graph-list-subscriptions.js
 */

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

function readSecretFile(name) {
  try {
    const p = path.resolve(process.cwd(), 'secrets', name);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8').trim();
    }
  } catch (_) {}
  return null;
}

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return null;
}

async function getAppOnlyToken() {
  const tenantId = process.env.MICROSOFT_TENANT_ID || readSecretFile('MICROSOFT_TENANT_ID') || 'common';
  const clientId = process.env.MICROSOFT_CLIENT_ID || readSecretFile('MICROSOFT_CLIENT_ID');
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || readSecretFile('MICROSOFT_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('Missing MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET (env or secrets/)');
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  });
  const resp = await axios.post(tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30000,
  });
  return resp.data.access_token;
}

async function main() {
  const subId = getArg('--id');
  const verbose = process.argv.includes('--verbose');
  const accessToken = process.env.ACCESS_TOKEN || null;

  let token = accessToken;
  if (!token) {
    if (verbose) console.log('ACCESS_TOKEN not provided; attempting app-only token via client credentials...');
    try {
      token = await getAppOnlyToken();
    } catch (err) {
      const status = err.response?.status;
      const body = err.response?.data;
      console.error('Failed to obtain app-only token:', err.message || err);
      if (status || body) {
        console.error('Token endpoint response:', { status, body });
      }
      process.exit(1);
    }
  }

  const http = axios.create({
    baseURL: 'https://graph.microsoft.com/v1.0',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });

  try {
    let data;
    if (subId) {
      if (verbose) console.log(`Fetching subscription ${subId}...`);
      const resp = await http.get(`/subscriptions/${encodeURIComponent(subId)}`);
      data = resp.data;
    } else {
      if (verbose) console.log('Listing subscriptions...');
      const resp = await http.get('/subscriptions');
      data = resp.data;
    }

    console.log(JSON.stringify(data, null, 2));
    if (!subId && Array.isArray(data.value)) {
      console.log(`\nTotal: ${data.value.length}`);
      for (const s of data.value) {
        console.log(`- ${s.id} | ${s.resource} | expires: ${s.expirationDateTime}`);
      }
    }
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    console.error('Graph request failed:', status, JSON.stringify(body || err.message));
    if (status === 401) {
      console.error('Unauthorized. If subscriptions were created with delegated user tokens, set ACCESS_TOKEN to a user token.');
    }
    process.exit(2);
  }
}

main();
