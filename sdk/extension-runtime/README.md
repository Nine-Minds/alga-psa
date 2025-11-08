# @alga/extension-runtime

Utility types and helper functions for Alga extension components compiled with [`componentize-js`](https://github.com/bytecodealliance/componentize-js).

## Usage

```ts
import { Handler, jsonResponse } from '@alga/extension-runtime';

export const handler: Handler = async (request, host) => {
  const secret = await host.secrets.get('alga_api_key');
  await host.logging.info(`Handling request for ${request.context.tenantId}`);
  return jsonResponse({ ok: true, secret, path: request.http.path });
};
```

The helpers mirror the WIT definitions in `ee/runner/wit/extension-runner.wit`.

Run `npm run build` before publishing.
