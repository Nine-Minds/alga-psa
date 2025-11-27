# Client Portal Test Extension

A sample extension demonstrating the `clientPortalMenu` hook with a WASM handler backend.

## Features

- Registers a menu item in the Client Portal "Apps" dropdown
- Displays extension context (extension ID, tenant ID, path)
- Calls a WASM handler via the `/api/ext/{extensionId}/` proxy
- Shows the handler response with request metadata

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
│   └── main.js        # UI JavaScript
└── wit/
    └── ext.wit        # WIT interface definition
```

## Building

```bash
npm install
npm run build
```

This will:
1. Compile `src/handler.ts` to JavaScript
2. Use `jco componentize` to create a WASM component at `dist/main.wasm`

## Bundling

```bash
tar --zstd -cf bundle.tar.zst manifest.json ui/ dist/
shasum -a 256 bundle.tar.zst
```

## Manifest Hooks

```json
{
  "ui": {
    "hooks": {
      "clientPortalMenu": {
        "label": "Test Extension"
      }
    }
  }
}
```

## API Endpoints

The extension defines two endpoints handled by the same WASM handler:

- `GET /` - Returns handler info and context
- `GET /info` - Same as above

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
