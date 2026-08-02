# Edition alias cleanup and architecture documentation plan

Ticket: `alga0002211` — Remove stale CE stub-synthesis from `Dockerfile.build` and rewrite the edition architecture doc

## Context

The CE image build currently deletes `ee/server` and then recreates a partial version of it from `server/src/empty`, plus four handwritten JavaScript shims. That mechanism predates the edition-aware aliases now maintained in `server/next.config.mjs`. It has drifted from the real CE fallback surface and can mask missing or incorrect aliases.

The existing `docs/getting-started/enterprise_edition_architecture.md` describes the former `ee/server`-centric workspace, obsolete package scripts, and a compose overlay that no longer represents the supported build and runtime paths. The replacement should document the configuration that actually selects CE versus EE code today.

## Implementation

### 1. Remove Docker-time EE stub synthesis

Update `Dockerfile.build` in the builder stage:

- Keep `RUN rm -rf /app/ee/server`; CE must not ship or compile the proprietary server tree.
- Keep `ee/packages/workflows` intact because the workspace symlink is required by dependency installation.
- Delete the commands that recreate `/app/ee/server/src` from `server/src/empty`.
- Delete the handwritten `lib/extensions/initialize.js` shim.
- Delete the handwritten `chatStreamService.js`, `temporaryApiKeyService.js`, and `chatCompletionsService.js` shims.
- Replace the surrounding comments with a short statement that CE resolution is owned by the Next aliases and checked-in fallback modules, so future contributors do not reintroduce build-generated source.

No product behavior or checked-in fallback implementation should move as part of this cleanup. If the CE build exposes an unresolved import, fix the authoritative alias/fallback mapping rather than restoring generated files.

### 2. Rewrite the edition architecture guide from current configuration

Replace `docs/getting-started/enterprise_edition_architecture.md` with a concise guide derived from the repository's live configuration. Cover:

- **Edition selection:** explain how `EDITION`, `NEXT_PUBLIC_EDITION`, and the `isEE` calculation in `server/next.config.mjs` select community or enterprise behavior. Use the accepted values visible in code and avoid presenting invented package scripts.
- **Source ownership:** distinguish shared/open server code (`server/src`), checked-in CE fallback modules (`server/src/empty`), enterprise server implementations (`ee/server/src`), and the package-level EE surface (`packages/ee/src`). Mention the separately retained `ee/packages/workflows` workspace where relevant.
- **`@ee/*` seam:** document that EE builds resolve to `ee/server/src`, while CE builds resolve the same import surface to checked-in files under `server/src/empty`. Make `server/next.config.mjs` the source of truth and explain that CE must never depend on generated `ee/server` files.
- **`@/empty/*` seam:** describe it as an explicit import of the checked-in no-op/unsupported implementation, independent of edition switching, and clarify when it is preferable to an `@ee/*` import.
- **`@product/*` seams:** explain that product entry points choose an EE entry or CE entry/fallback in `server/next.config.mjs`; contributors should import the stable product alias rather than reaching across repository directories with relative paths.
- **Bundler parity:** note that Webpack and Turbopack mappings must be updated together, including exact and directory/subpath variants where the configuration requires them. Point readers to the alias definitions and replacement wiring rather than duplicating a long, drift-prone alias inventory.
- **Adding a new edition-aware feature:** provide a short checklist: define the stable import seam, add the CE implementation, add the EE implementation, wire both bundlers, avoid direct cross-edition relative imports, and test both editions.
- **Build/deployment references:** state only commands that exist in the current repository. Link to the current compose/build documentation for operational setup rather than preserving the obsolete `ee/setup/docker-compose.yaml` walkthrough.

Remove the old sample workspace manifests, fictional `getFeatureImplementation` example, stale dependency advice, obsolete build scripts, and old compose commands. They imply an architecture the repository no longer uses.

### 3. Validate the cleanup behaviorally

Run the repository's existing build paths rather than adding source-string tests:

1. Build the CE image or execute the equivalent CE Next/Webpack build used by `Dockerfile.build`; confirm it succeeds after `/app/ee/server` is removed and without recreating that directory.
2. Run the corresponding EE build to ensure the real `ee/server/src` implementations still resolve.
3. If a faster documented alias/build smoke command exists in the repository, run it in addition to—not instead of—the CE build that exercises the deleted Docker behavior.
4. Inspect the built CE context/image (or add a temporary diagnostic during local validation) to confirm none of the deleted handwritten files are synthesized.
5. Review every command and path in the rewritten guide against `package.json`, compose files, and `server/next.config.mjs` before committing.

Do not add tests that merely grep `Dockerfile.build` or assert documentation/source strings. The meaningful regression check is that a CE build resolves all edition seams without a fabricated `ee/server` tree.

## Expected files

- `Dockerfile.build`
- `docs/getting-started/enterprise_edition_architecture.md`

Any change to `server/next.config.mjs`, `server/src/empty`, or product entries should occur only if the CE build reveals a real missing mapping; keep such fixes narrowly scoped and document the newly required seam.
