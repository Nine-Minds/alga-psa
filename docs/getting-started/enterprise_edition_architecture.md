# Edition-aware source architecture

AlgaPSA keeps shared server code and edition-specific implementations in one
workspace. Shared code imports stable aliases. `server/next.config.mjs` selects
the Community Edition (CE) or Enterprise Edition (EE) implementation when Next.js
builds the application.

Do not create edition stubs during a Docker build. CE fallbacks are checked-in
source files so local development, type checking, Turbopack, and Webpack use the
same implementations.

## Selecting an edition

`server/next.config.mjs` enables EE when any of these conditions is true:

- `EDITION=ee`
- `EDITION=enterprise`
- `NEXT_PUBLIC_EDITION=enterprise`

All other values select CE. Keep `EDITION` and `NEXT_PUBLIC_EDITION` consistent
because the first is server-facing and the second may be included in browser
code. The root scripts set both variables:

```bash
npm run build          # CE, Turbopack
npm run build:webpack  # CE, Webpack
npm run build:ee       # EE, Webpack
```

## Source ownership

| Path | Responsibility |
| --- | --- |
| `server/src` | Shared application and server code. |
| `packages/ee/src` | Checked-in CE-compatible implementations for the `@ee/*` surface. These files also provide the default TypeScript path targets. |
| `server/src/empty` | Narrow CE fallbacks and empty shims used by seams that mirror paths under `ee/server/src`. |
| `ee/server/src` | Enterprise server implementations selected in EE builds. |
| `packages/product-*/oss` and `packages/product-*/ee` | Package-local implementations selected by stable product entry points. |

`ee/packages/workflows` is a separate workspace package. The CE Docker build
keeps that workspace because the installed `@alga-psa/workflows` dependency is a
workspace symlink, even though it removes `ee/server` before compiling the CE
application.

## Edition seams

### `@ee/*`

Use `@ee/*` when shared code needs one module shape with a CE-compatible
implementation and an EE implementation at the same relative path.

- CE resolves `@ee/*` to `packages/ee/src/*`.
- EE resolves `@ee/*` to `ee/server/src/*`.

The TypeScript configuration is CE-first and maps this alias to
`packages/ee/src`. The Next configuration overrides it for EE builds. Webpack
also rewrites the request before TypeScript path resolution can select a CE file.
The Next aliases and replacement wiring are authoritative; CE must not rely on a
generated `ee/server` tree.

### `@/empty/*`

Use `@/empty/*` for a shared-server seam whose CE implementation belongs in the
small fallback tree under `server/src/empty`. The normal `@/*` mapping sends the
CE import there. In an EE build, `server/next.config.mjs` redirects the same
relative path to `ee/server/src/*`.

Despite the name, this is an edition-switched seam in an EE build. Use it for
the established path-mirrored fallbacks. Prefer `@ee/*` for the broader
package-backed EE surface, or a product alias when the feature already has a
package entry point.

### `@product/*`

Product entry points expose a stable import while keeping both implementations
inside a product package. For example, `@product/chat/entry` selects
`packages/product-chat/oss/entry` in CE and `packages/product-chat/ee/entry` in
EE. Other product seams use the same pattern where their configuration requires
it.

Import the stable entry point from shared code. Do not import an `oss` or `ee`
directory directly and do not reach into `ee/server` with a relative path.
`server/next.config.mjs` contains the current product mappings.

## Keep Webpack and Turbopack in sync

`server/next.config.mjs` configures Turbopack in `turbopack.resolveAlias` and
Webpack in `config.resolve.alias`, with replacement plugins where an alias alone
cannot win over TypeScript paths or package exports. A seam may need both an
exact key and a trailing-slash or subpath form.

When you change an edition seam, update both bundlers. Follow the existing shape
for that seam instead of copying a long alias inventory into documentation.

## Add an edition-aware feature

1. Choose a stable import seam. Prefer a product entry point for a packaged
   feature and `@ee/*` for a path-mirrored implementation surface.
2. Add and export the CE implementation from `packages/ee/src`,
   `server/src/empty`, or the product package's `oss` entry, as required by the
   selected seam.
3. Add the matching EE implementation.
4. Wire exact and subpath variants in both the Turbopack and Webpack sections of
   `server/next.config.mjs`. Add replacement wiring when the existing seam uses
   it.
5. Keep shared code free of cross-edition relative imports.
6. Type-check and build both CE and EE. Include the CE Webpack build because it
   is the path used by `Dockerfile.build`.

For container setup and deployment commands, see
[Docker Compose Structure](docker_compose.md). For local development, see the
[Development Guide](development_guide.md).
