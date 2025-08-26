# @alga/example-extension (Vite + React + TypeScript)

Minimal example app demonstrating the Alga Client SDK (iframe) and UI Kit.

What this shows:
- Initialization with the SDK hooks:
  - useBridge()
  - useTheme()
  - useAuthToken()
  - useResize()
- Simple UI using @alga/ui-kit primitives
- Reporting resize events to the parent for iframe autosizing

Prereqs:
- Monorepo bootstrapped with workspace tooling (pnpm/yarn). This example expects local workspace links to:
  - @alga/extension-iframe-sdk
  - @alga/ui-kit

Install and run:
- pnpm dev (or yarn dev)
- pnpm build (or yarn build)
- pnpm preview (or yarn preview)

Build output:
- Produces a static bundle under ./dist:
  - index.html
  - assets/*

Embedding via iframe:
- Place the static files under the cached ui directory for the extension:
  ui/**/* => /ext-ui/{extensionId}/{content_hash}/index.html
- Use the host helper to construct the src:
  - buildExtUiSrc(extensionId, contentHash, clientPath)
- Or directly set an iframe src using the conventional path:
  - Relative (Rust host path):
    /ext-ui/{extensionId}/{content_hash}/index.html?path=/ 
  - Absolute (when RUNNER_PUBLIC_BASE is absolute):
    ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/index.html?path=/

Parent-side bootstrap:
- Use bootstrapIframe() to:
  - Validate contentHash and origin
  - Set sandbox="allow-scripts" by default (no allow-same-origin)
  - Inject theme tokens into :root on the parent document
  - Send a versioned bootstrap envelope with session + theme + navigation
- API lives at:
  ee/server/src/lib/extensions/ui/iframeBridge.ts

Security notes:
- Always set sandbox="allow-scripts" on the iframe
- Do not include allow-same-origin unless a specific API requires it and risks are reviewed
- Parent uses a strict targetOrigin; child validates expected parent origin
- Example CSP for embedding page:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self' https://api.example.com;
  frame-src https://runner.example.com;

Files in this example:
- index.html: Mount div#root and module entry
- src/main.tsx: React root
- src/App.tsx: Demonstrates SDK hooks + UI Kit
- vite.config.ts: base './' so static deploy works under nested path
- tsconfig.json: strict + path aliases to local packages
- .gitignore: node_modules, dist