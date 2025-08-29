# Client SDK Component Gallery (Extension Scaffold)

This directory contains a scaffold for a UI-only extension that demonstrates the client SDK. It is intentionally light-weight; for a runnable example, see `packages/extension-iframe-sdk/examples/vite-react`.

Suggested structure:
- `ui/` static build output (index.html + assets/*) to be served by the Runner under `/ext-ui/{extensionId}/{content_hash}/...`
- `src/` development source if you choose to keep it here

Key features to demonstrate:
- Bridge readiness: `useBridge()`
- Theme tokens: `useTheme()`
- Auth token: `useAuthToken()`
- Resize reporting: `useResize()`

See docs under `docs/client-sdk/` for details.

