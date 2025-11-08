# Service Proxy UI Demo

This sample iframe component consumes the JSON produced by the `service-proxy-demo` component without ever touching the API key. The iframe talks to the Runner via the UI proxy channel:

```ts
const result = await callProxyJson(uiProxy, '/tickets/list', { limit: 10 });
```

Only the Runner component sees the secret API key – the browser receives a sanitised ticket list.

Run the type-checks and unit tests with:

```bash
npm install
npm test
```
