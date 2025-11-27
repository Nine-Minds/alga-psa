# Client Portal Test Extension

A sample extension demonstrating the `clientPortalMenu` hook with a WASM handler backend using the **postMessage proxy pattern**.

> **Note for external developers:** To create a new extension project from scratch, install the CLI globally and use the scaffolding command:
> ```bash
> npm install -g @alga-psa/cli
> alga create extension my-extension
> ```

## Features

- Registers a menu item in the Client Portal "Apps" dropdown
- Displays extension context (extension ID, tenant ID, path)
- Calls a WASM handler via the **postMessage proxy pattern** (not direct fetch)
- Shows the handler response with request metadata

## Proxy Pattern

This sample demonstrates the recommended way for extension UIs to communicate with their WASM handlers:

1. **Iframe sends `apiproxy` message** to the host via `window.parent.postMessage()`
2. **Host bridge receives the message** and forwards to `/api/ext-proxy/{extensionId}/{route}`
3. **Runner executes the WASM handler** and returns the response
4. **Host sends `apiproxy_response` message** back to the iframe

This pattern ensures:
- The iframe never makes direct HTTP requests to extension APIs
- Authentication is handled by the host
- Secrets never reach the browser

See `ui/main.js` for the implementation.

## Structure

```
client-portal-test/
├── manifest.json      # Extension manifest with clientPortalMenu hook
├── package.json       # Build configuration
├── tsconfig.json      # TypeScript config for handler
├── src/
│   └── handler.ts     # WASM handler implementation
├── ui/
│   ├── index.html     # Extension UI
│   └── main.js        # UI JavaScript (proxy pattern implementation)
└── wit/
    └── ext.wit        # WIT interface definition
```

## Building

**Using the Alga CLI (recommended):**

```bash
npm install
npm run build    # runs: alga build
```

Or directly with the CLI:

```bash
alga build
```

This will:
1. Compile `src/handler.ts` to JavaScript (via esbuild)
2. Use `jco componentize` to create a WASM component at `dist/main.wasm`

## Bundling

**Using the Alga CLI:**

```bash
npm run pack     # runs: alga pack
```

**Manual bundling:**

```bash
tar --zstd -cf bundle.tar.zst manifest.json ui/ dist/main.wasm
shasum -a 256 bundle.tar.zst
```

## Manifest

```json
{
  "name": "com.alga.sample.client-portal-test",
  "version": "1.2.0",
  "runtime": "wasm-js@1",
  "capabilities": ["cap:context.read", "cap:log.emit", "cap:ui.proxy"],
  "ui": {
    "type": "iframe",
    "entry": "ui/index.html",
    "hooks": {
      "clientPortalMenu": { "label": "Test Extension" }
    }
  },
  "assets": ["ui/**/*"]
}
```

Note: The `cap:ui.proxy` capability is required for the proxy pattern.

## Handler Response

The WASM handler returns JSON with:

```json
{
  "ok": true,
  "message": "Hello from the Client Portal Test Extension WASM handler!",
  "context": {
    "tenantId": "...",
    "extensionId": "...",
    "installId": "...",
    "requestId": "..."
  },
  "request": {
    "method": "GET",
    "url": "/",
    "path": "/"
  },
  "build": "2025-11-27T03:48:23.372Z",
  "timestamp": "2025-11-27T04:08:15.123Z"
}
```
