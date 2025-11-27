# Dual Portal Demo Extension

A sample extension demonstrating how to build a **single extension that works in both the MSP Portal and Client Portal**. Uses the **postMessage proxy pattern** for WASM handler communication.

> **Note for external developers:** To create a new extension project from scratch, install the CLI globally and use the scaffolding command:
> ```bash
> npm install -g @alga-psa/cli
> alga create extension my-extension
> ```

## Features

- **Dual Portal Support**: Registers in both MSP Portal (`appMenu`) and Client Portal (`clientPortalMenu`)
- **Context Detection**: Automatically detects which portal it's running in
- **Different UIs**: Shows different features and styling based on portal context
- **Proxy Pattern**: Calls WASM handler via postMessage (not direct fetch)

## How It Works

### Dual Hook Registration

The manifest registers the extension in both portals using multiple hooks:

```json
{
  "ui": {
    "hooks": {
      "appMenu": { "label": "Dual Portal Demo" },
      "clientPortalMenu": { "label": "Dual Portal Demo" }
    }
  }
}
```

### Context Detection

The UI detects which portal it's running in by checking the referrer URL:

```javascript
const referrer = document.referrer || '';
const isClientPortal = referrer.includes('/client-portal/');
const portalType = isClientPortal ? 'client' : 'msp';
```

### Different UIs Per Portal

Based on the detected context, the extension:
- Applies different CSS color schemes (purple for MSP, cyan for Client)
- Shows different feature lists appropriate to each user type
- Can pass the portal type to the WASM handler for server-side logic

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
├── manifest.json      # Extension manifest with both portal hooks
├── package.json       # Build configuration
├── tsconfig.json      # TypeScript config for handler
├── src/
│   └── handler.ts     # WASM handler implementation
├── ui/
│   ├── index.html     # Extension UI with portal-aware styling
│   └── main.js        # UI JavaScript (context detection + proxy pattern)
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
  "version": "1.3.0",
  "runtime": "wasm-js@1",
  "capabilities": ["cap:context.read", "cap:log.emit", "cap:ui.proxy"],
  "ui": {
    "type": "iframe",
    "entry": "ui/index.html",
    "hooks": {
      "appMenu": { "label": "Dual Portal Demo" },
      "clientPortalMenu": { "label": "Dual Portal Demo" }
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
  "message": "Hello from the Dual Portal Demo WASM handler!",
  "portalType": "client",
  "context": {
    "tenantId": "...",
    "extensionId": "...",
    "installId": "...",
    "requestId": "..."
  },
  "timestamp": "2025-11-27T04:08:15.123Z"
}
```
