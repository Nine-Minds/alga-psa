# Service Proxy Demo Component

This sample shows how a server-side extension component can:

1. Retrieve an API key from the Runner secrets store.
2. Call the Alga PSA Tickets API via the Runner's HTTP capability.
3. Expose the ticket data to an iframe UI through the UI proxy capability without ever leaking the API key to the browser.

## How it works

- The component expects the Runner to inject a secret named `ALGA_API_KEY`.
- The install's config can optionally define `algaApiBase` to override the API base URL (defaults to `https://api.alga-psa.local`).
- When the component receives an HTTP request under `/dynamic/tickets`, it fetches tickets directly from the Alga API and returns JSON to the gateway.
- When the iframe UI calls `callProxyJson(uiProxy, '/tickets/list', { limit: 10 })`, the Runner forwards the request to the same component via the UI proxy channel. The component repeats the fetch server-side and returns JSON to the iframe. The iframe only ever sees the response payload, never the API key.

See [`tests/handler.test.ts`](./tests/handler.test.ts) for mocked end-to-end coverage.

## Running the sample

```bash
npm install
npm test
```

In a full extension project you would build the component with `componentize-js` via `npm run component` (see the `package.json` script) and publish the produced `dist/component.wasm` alongside your UI bundle.
