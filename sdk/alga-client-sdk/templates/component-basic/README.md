# __PACKAGE_NAME__ Component Template

This project was generated with `alga create component`. It targets the Alga extension runner
using the WebAssembly Component Model and [`componentize-js`](https://github.com/bytecodealliance/componentize-js).

## Available scripts

- `npm run build` – build the extension using the Alga CLI (compiles TypeScript and produces WASM)
- `npm run pack` – package the extension into a distributable bundle
- `npm run clean` – remove build artifacts

## Project structure

- `src/` – TypeScript sources implementing the `handler` export defined in `wit/extension-runner.wit`.
- `src/types.ts` – convenience copies of the WIT data structures for use in TypeScript.
- `wit/extension-runner.wit` – WIT world definitions describing the host capabilities exposed by the runner.
- `dist/` – build output (`dist/js` for the intermediate JS bundle, `dist/main.wasm` for the component artifact).

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

The final component artifact will be written to `dist/main.wasm`.

## Packaging

```bash
npm run pack     # runs: alga pack
```

This creates a `bundle.tar.zst` archive containing the manifest, WASM component, and any UI assets.

## Using Host Capabilities

To use host capabilities like logging, user info, secrets, or storage, you need to:

1. **Create a wrapper `index.ts`** that imports WIT functions and builds `HostBindings`
2. **Use a custom build script** with external imports

### Example: Accessing User Info

Create `src/index.ts`:

```typescript
import { handler as userHandler } from './handler-impl.js';
import { ExecuteRequest, ExecuteResponse, HostBindings } from '@alga-psa/extension-runtime';

// @ts-ignore - WIT imports resolved at runtime
import { getUser } from 'alga:extension/user';
// @ts-ignore
import { logInfo, logWarn, logError } from 'alga:extension/logging';
// @ts-ignore
import { getContext } from 'alga:extension/context';

const host: HostBindings = {
  context: { get: async () => getContext() },
  logging: {
    info: async (msg) => logInfo(msg),
    warn: async (msg) => logWarn(msg),
    error: async (msg) => logError(msg),
  },
  user: { getUser: async () => getUser() },
  // Add other bindings as needed
};

export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  return userHandler(request, host);
}
```

Rename your handler to `src/handler-impl.ts` and update the signature:

```typescript
import { ExecuteRequest, ExecuteResponse, HostBindings, jsonResponse } from '@alga-psa/extension-runtime';

export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  // Now you can use host bindings
  const user = await host.user.getUser();
  await host.logging.info(`Request from ${user.userName}`);

  return jsonResponse({
    ok: true,
    user: { name: user.userName, type: user.userType },
  });
}
```

Update `package.json` with a custom build:

```json
{
  "scripts": {
    "build:backend": "esbuild src/index.ts --bundle --format=esm --platform=neutral --outfile=dist/js/index.js --external:alga:extension/secrets --external:alga:extension/http --external:alga:extension/storage --external:alga:extension/logging --external:alga:extension/ui-proxy --external:alga:extension/context --external:alga:extension/user",
    "build:component": "jco componentize dist/js/index.js --wit ./wit/extension-runner.wit --world-name runner --disable all --out dist/main.wasm",
    "build": "npm run build:backend && npm run build:component"
  },
  "devDependencies": {
    "@bytecodealliance/jco": "^1.8.0",
    "esbuild": "^0.20.0"
  }
}
```

## Available Host Capabilities

| Capability | Interface | Description |
|------------|-----------|-------------|
| `cap:context.read` | `context` | Execution context (tenant, extension IDs) |
| `cap:secrets.get` | `secrets` | Install-scoped secrets |
| `cap:http.fetch` | `http` | Outbound HTTP requests |
| `cap:storage.kv` | `storage` | Key-value storage |
| `cap:log.emit` | `logging` | Structured logging |
| `cap:ui.proxy` | `ui-proxy` | UI proxy routes |
| `cap:user.read` | `user` | Current user info (default) |
| `cap:scheduler.manage` | `scheduler` | Scheduled tasks |
| `cap:invoice.manual.create` | `invoicing` | Create draft manual invoices |

See the [User Host API Guide](../../../docs/guides/user-host-api.md), [Scheduler Host API Guide](../../../docs/guides/scheduler-host-api.md), and [Invoicing Host API Guide](../../../docs/guides/invoicing-host-api.md) for detailed usage.

## Next steps

- Implement your business logic inside `src/handler.ts` (or `src/handler-impl.ts` if using host bindings).
- Use the host capabilities to interact with secrets, storage, user info, etc.
- Add tests (e.g., using Vitest) that exercise your handler logic.
- When ready, run `npm run build` and `npm run pack` to create a distributable bundle.
- Use `alga extension publish` to upload your extension to an Alga instance.
