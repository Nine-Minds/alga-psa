// Signs a Stripe-style webhook payload with the shared webhook secret and
// POSTs it to the AI gateway's /webhooks/stripe route. This exercises the
// gateway's REAL signature verification, idempotency, and state machine —
// only the Stripe event author is simulated.
//
// Usage: node stripe-send.mjs <gateway-url> <webhook-secret> <payload-file.json>

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [gatewayUrl, secret, payloadFile] = process.argv.slice(2);
if (!gatewayUrl || !secret || !payloadFile) {
  console.error('usage: node stripe-send.mjs <gateway-url> <webhook-secret> <payload-file.json>');
  process.exit(1);
}

const payload = readFileSync(payloadFile, 'utf8');
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac('sha256', secret)
  .update(`${timestamp}.${payload}`)
  .digest('hex');

const response = await fetch(`${gatewayUrl.replace(/\/+$/, '')}/webhooks/stripe`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Stripe-Signature': `t=${timestamp},v1=${signature}`,
  },
  body: payload,
});
console.log(response.status, await response.text());
