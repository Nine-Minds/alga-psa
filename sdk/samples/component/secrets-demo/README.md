# Secrets Demo Component

A minimal Alga PSA extension component demonstrating how to retrieve secrets from the Runner using the `secrets.get` capability.

## What it does

This sample component:
1. Receives an HTTP request via the Gateway
2. Retrieves a secret named `greeting` from the Runner's secrets store
3. Falls back to the string `'hello'` if the secret is missing
4. Returns a JSON response containing the message, request path, and install config

## How it works

```typescript
import { get as getSecret } from 'alga:extension/secrets';

export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  const message = await getSecret('greeting').catch(() => 'hello');
  return jsonResponse({ message, path: request.http.url, config: request.context.config ?? {} });
}
```

The handler imports the `secrets.get` function directly from the WIT interface, which is bound at runtime by the component runner.

## Building

```bash
npm install
npm run build
```

### Build output

- `dist/component.wasm` — The compiled WASM component
- `dist/main.wasm` — Alias for the component (referenced by manifest)
- `dist/component.json` — Metadata with capabilities
- `dist/js/` — Intermediate JavaScript artifacts
- `dist/bundle.tar.zst` — Packaged extension bundle (5.4 MB)
- `dist/bundle.sha256` — SHA256 integrity hash

**Bundle Hash:**
```
c4a9d892a80e31c34ba6630b56044cc44d46b5171b8f9c04095e527dc0228b2b
```

## Packaging and Publishing

### Manifest

The `manifest.json` declares the extension metadata and handler endpoint:

```json
{
  "name": "com.alga.sample.secrets-demo",
  "publisher": "Alga",
  "version": "0.1.0",
  "runtime": "wasm-js@1",
  "capabilities": ["secrets.get"],
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

This sample declares the `secrets.get` capability in its manifest, requesting permission to retrieve install-scoped secrets at runtime.

### WIT Interfaces

The component imports the `secrets` interface from `alga:extension/secrets`, which is defined in [wit/extension-runner.wit](wit/extension-runner.wit). The runner provides this capability at instantiation.

### Error Handling

The handler gracefully falls back to `'hello'` if the secret is missing or retrieval fails. In production, you'd typically return an error response instead.

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
