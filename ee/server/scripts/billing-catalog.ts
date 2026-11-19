#!/usr/bin/env tsx
/**
 * Nine Minds operator CLI for the shared Stripe offer catalog (rotate the co-managed seat price
 * without a deployment). A thin client: the platform runs the command with its own Stripe credential
 * and database, after proving you are a platform operator, so this needs no Stripe or DB access.
 *
 *   npm run billing-catalog -- inspect
 *   npm run billing-catalog -- inventory                       # pre-cutover: report unmapped prices
 *   npm run billing-catalog -- seed [--historical=price_a,price_b] [--product=prod_x] --confirm
 *   npm run billing-catalog -- publish --price=price_new [--product=prod_x]          # dry run: review only
 *   npm run billing-catalog -- publish --price=price_new --expect=<current version id|none> --confirm
 *   npm run billing-catalog -- restore --version=<version id> --expect=<current version id|none> --confirm
 *   npm run billing-catalog -- pause --expect=<current version id> --confirm      # stop new sales; renewals continue
 *   npm run billing-catalog -- retry-fulfillments                           # re-deliver pending appliance licences
 *
 * Environment: ALGA_PSA_URL (platform base URL) and ALGA_OPERATOR_API_KEY (an API key of the master
 * billing tenant, the same authority the operator console routes require).
 * Optional flags: --offer=<key> (default co_managed_technician_seat), --interval=month.
 * Exit: 0 ok, 1 error or rejected, 2 needs attention (unmapped prices, missing --expect, failed deliveries).
 */
async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') { console.log('Usage: billing-catalog inspect|inventory|seed|publish|restore|pause|retry-fulfillments [flags] (see the file header)'); return 0; }
  const base = process.env.ALGA_PSA_URL;
  const apiKey = process.env.ALGA_OPERATOR_API_KEY;
  if (!base || !apiKey) throw new Error('Set ALGA_PSA_URL and ALGA_OPERATOR_API_KEY (a master-tenant API key).');
  const response = await fetch(new URL('/api/v1/billing-catalog/operator', base), {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ command, args }),
  });
  const body = await response.json().catch(() => ({})) as { success?: boolean; data?: { code: number; lines: string[] }; error?: string; code?: string; problems?: string[] };
  if (!response.ok || !body.success || !body.data) {
    console.error(`${body.code ?? `HTTP ${response.status}`}: ${body.error ?? 'request failed'}`);
    for (const problem of body.problems ?? []) console.error(`  - ${problem}`);
    return 1;
  }
  for (const line of body.data.lines) console.log(line);
  return body.data.code;
}

main().then((code) => process.exit(code), (error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
