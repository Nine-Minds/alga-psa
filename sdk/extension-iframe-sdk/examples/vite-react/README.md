# @alga/example-extension (Vite + React + TypeScript)

Minimal example app demonstrating the Alga Client SDK (iframe) and (optionally) the UI Kit.

Shows:
- SDK hooks: `useBridge()`, `useTheme()`, `useAuthToken()`, `useResize()`
- Reporting resize events to the parent for iframe autosizing

Install and run:
- `pnpm dev` (or `yarn dev`)
- `pnpm build` (or `yarn build`)
- `pnpm preview` (or `yarn preview`)

Build output:
- Static bundle under `./dist`:
  - `index.html`
  - `assets/*`

Embedding via iframe:
- Host at `/ext-ui/{extensionId}/{content_hash}/index.html?path=/`
- Or `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/index.html?path=/`

Parent-side bootstrap:
- See `ee/server/src/lib/extensions/ui/iframeBridge.ts`

Security notes:
- Use `sandbox="allow-scripts"` (avoid `allow-same-origin` unless strictly necessary)
- Use strict `targetOrigin` in parent; validate expected parent origin in child

