# Secrets Demo Component

A minimal Alga PSA extension component demonstrating how to retrieve secrets from the Runner and stream debug logs using the `cap:secrets.get` and `cap:log.emit` capabilities.

## What it does

This sample component:
1. Receives an HTTP request via the Gateway
2. Retrieves a secret named `greeting` from the Runner's secrets store
3. Falls back to the string `'hello'` if the secret is missing
4. Returns a JSON response containing the message, request path, and install config
5. Emits structured log events (`log-info` / `log-warn`) so the EE Debug Console can capture them via the Redis stream

## How it works

```typescript
import { get as getSecret } from 'alga:extension/secrets';
import { logInfo, logWarn } from 'alga:extension/logging';

export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  const method = request.http.method || 'GET';
  const url = request.http.url || '/';
  const requestId = request.context.requestId ?? 'n/a';

  logInfo(`[secrets-demo] request start requestId=${requestId} method=${method} url=${url}`);

  let message: string;
  try {
    message = await getSecret('greeting');
    logInfo('[secrets-demo] greeting secret resolved');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logWarn(`[secrets-demo] greeting secret missing; falling back. reason=${reason}`);
    message = 'hello';
  }

  return jsonResponse({ message, path: url, config: request.context.config ?? {} });
}
```

The handler imports the `secrets` interface directly from the WIT bindings while also calling the `logging` interface so every request generates debug events that the Runner forwards to Redis/the EE Debug Console.

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

### Build output

- `dist/main.wasm` — The compiled WASM component
- `dist/js/` — Intermediate JavaScript artifacts

### Packaging

```bash
npm run pack     # runs: alga pack
```

This creates `dist/bundle.tar.zst` with the manifest, WASM component, and assets.

## Packaging and Publishing

### Manifest

The `manifest.json` declares the extension metadata and handler endpoint:

```json
{
  "name": "com.alga.sample.secrets-demo",
  "publisher": "Alga",
  "version": "0.1.0",
  "runtime": "wasm-js@1",
  "capabilities": ["cap:secrets.get", "cap:log.emit"],
  "api": {
    "endpoints": [
      { "method": "GET", "path": "/", "handler": "dist/main" }
    ]
  },
  "assets": []
}
```

### Pack

The bundle has already been packed with:

```bash
npx alga pack . dist/bundle.tar.zst
```

To re-pack after changes:

```bash
export PATH="/opt/homebrew/bin:$PATH"  # Ensure zstd is in PATH (macOS)
npx alga pack . dist/bundle.tar.zst
```

### Publish

To publish to your Alga PSA server:

```bash
export PATH="/opt/homebrew/bin:$PATH"
ALGA_ADMIN_HEADER=true npx alga publish \
  --bundle dist/bundle.tar.zst \
  --manifest manifest.json \
  --declared-hash c4a9d892a80e31c34ba6630b56044cc44d46b5171b8f9c04095e527dc0228b2b \
  --server http://localhost:3000
```

The published bundle will be stored at:
- `sha256/<hash>/bundle.tar.zst`
- `sha256/<hash>/manifest.json`

See [Enterprise Build Workflow](ee/docs/extension-system/enterprise-build-workflow.md) for more details.

## Testing

```bash
npm test
```

Runs the handler tests using Vitest.

## Key Concepts

### Capabilities

This sample declares `cap:secrets.get` (to read install-scoped secrets) and `cap:log.emit` (to stream structured logs into the EE Debug Console).

### WIT Interfaces

The component imports the `secrets` interface from `alga:extension/secrets`, which is defined in [wit/extension-runner.wit](wit/extension-runner.wit). The runner provides this capability at instantiation.

### Error Handling

The handler gracefully falls back to `'hello'` if the secret is missing or retrieval fails. In production, you'd typically return an error response instead.

### Live Debug Logging

When this component runs inside the EE environment, each `log-info` / `log-warn` call is forwarded to the Runner's Redis-backed debug stream. Use the **Debug Console** link on `/msp/settings?tab=extensions` (or go directly to `/msp/extensions/<registryId>/debug`) to confirm that the `[secrets-demo] …` messages appear in real time. Avoid logging raw secret values—this sample only logs request metadata and fallback reasons.

## Next Steps

- Add more capabilities (http.fetch, storage.kv, etc.)
- Implement additional API endpoints
- Add a UI with `ui.iframe` and the client SDK
- See [Development Guide](ee/docs/extension-system/development_guide.md) for the full extension architecture

## References

- [Manifest Schema](ee/docs/extension-system/manifest_schema.md)
- [Security & Signing](ee/docs/extension-system/security_signing.md)
- [Sample Extension](ee/docs/extension-system/sample_template.md)
- [Runner](ee/docs/extension-system/runner.md)
