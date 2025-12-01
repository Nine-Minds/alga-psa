# Service Proxy Demo Extension

This sample demonstrates a full extension (Server Component + Iframe UI) that uses the Service Proxy pattern.

1. **Server Component**: Retrieves an API key from the Runner secrets store and calls the Alga PSA Tickets API via the Runner's HTTP capability.
2. **Iframe UI**: Exposes the ticket data through the UI proxy capability without ever leaking the API key to the browser.

## How it works

- The component expects the Runner to inject a secret named `ALGA_API_KEY`.
- The install's config can optionally define `algaApiBase` to override the API base URL (defaults to `https://api.alga-psa.local`).
- When the component receives an HTTP request under `/dynamic/tickets`, it fetches tickets directly from the Alga API and returns JSON to the gateway.
- When the iframe UI calls `callProxyJson(uiProxy, '/tickets/list', { limit: 10 })`, the Runner forwards the request to the same component via the UI proxy channel. The component repeats the fetch server-side and returns JSON to the iframe. The iframe only ever sees the response payload, never the API key.

See [`tests/handler.test.ts`](./tests/handler.test.ts) for mocked end-to-end coverage.

## Building and Testing

```bash
npm install
npm test
npm run build
```

The `npm run build` command will:
1. Transpile the TypeScript handler to JavaScript.
2. Componentize the JavaScript into a WASM component (`dist/component.wasm`) using `jco`.
3. Prepare the metadata for the extension.

## Project Structure

- `src/` - Server-side component logic (SDK-based).
- `ui/` - Client-side iframe UI.
- `wit/` - WIT definitions for the runner interface.
- `manifest.json` - Extension manifest.