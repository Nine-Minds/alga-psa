# Component Gallery Extension

A demo extension that showcases common UI patterns built with the SDK (and optionally the internal UI kit). This can be embedded via the Runner’s `/ext-ui/...` path.

## Goals
- Demonstrate `useBridge`, `useTheme`, `useAuthToken`, `useResize`
- Provide simple UI examples to copy/paste

## Location
- Source scaffold: `ee/extensions/client-sdk-gallery-ext/`
- Quick-start single-page example: `packages/extension-iframe-sdk/examples/vite-react/`

## Running (example app)
- `cd packages/extension-iframe-sdk/examples/vite-react`
- `pnpm dev` / `pnpm build`

## Embedding
- Serve the built `dist/` under `/ext-ui/{extensionId}/{content_hash}/index.html?path=/`
- Bootstrap the iframe in the host per `ee/server/src/lib/extensions/ui/iframeBridge.ts`

