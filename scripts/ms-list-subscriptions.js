#!/usr/bin/env node
// Lists Microsoft Graph change notification subscriptions using app credentials
// Reads credentials from environment variables:
// - MICROSOFT_TENANT_ID
// - MICROSOFT_CLIENT_ID
// - MICROSOFT_CLIENT_SECRET

import axios from 'axios';

async function main() {
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const refreshToken = process.env.MICROSOFT_REFRESH_TOKEN;
  const accessTokenEnv = process.env.MICROSOFT_ACCESS_TOKEN;
  const redirectUri = process.env.MICROSOFT_REDIRECT_URI;

  if (!tenantId || !clientId || !clientSecret) {
    console.error('Missing required env vars: MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET');
    process.exit(1);
  }

  try {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
    let accessToken;
    if (accessTokenEnv) {
      console.log('Using provided MICROSOFT_ACCESS_TOKEN');
      accessToken = accessTokenEnv;
    } else if (refreshToken) {
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        redirect_uri: redirectUri || 'https://localhost/unused',
        scope: 'https://graph.microsoft.com/.default offline_access'
      });
      process.stdout.write('Refreshing delegated access token... ');
      const resp = await axios.post(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      console.log('OK');
      accessToken = resp.data.access_token;
    } else {
      const tokenParams = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default'
      });
      process.stdout.write('Requesting app token... ');
      const tokenResp = await axios.post(tokenUrl, tokenParams.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      console.log('OK');
      accessToken = tokenResp.data.access_token;
    }
    const graph = axios.create({
      baseURL: 'https://graph.microsoft.com/v1.0',
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    process.stdout.write('Listing subscriptions... ');
    const subsResp = await graph.get('/subscriptions');
    console.log('OK');

    const subs = subsResp.data?.value || [];
    if (!subs.length) {
      console.log('\nNo subscriptions found for this app identity.');
      console.log('Note: App-only listing only shows subscriptions created by this same app identity.');
    } else {
      console.log(`\nFound ${subs.length} subscription(s):\n`);
      subs.forEach((s, idx) => {
        console.log(`#${idx + 1}`);
        console.log(`  id:                 ${s.id}`);
        console.log(`  resource:           ${s.resource}`);
        console.log(`  notificationUrl:    ${s.notificationUrl}`);
        console.log(`  expirationDateTime: ${s.expirationDateTime}`);
        console.log(`  clientState:        ${s.clientState || ''}`);
        console.log('');
      });
    }
  } catch (err) {
    const detail = err?.response?.data || err?.message || err;
    console.error('\nFailed:', typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
    process.exit(2);
  }
}

main();
