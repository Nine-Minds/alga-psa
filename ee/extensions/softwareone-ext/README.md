# SoftwareOne Extension (Enterprise)

This package adds SoftwareOne navigation, settings, agreements, and statements UI to Alga PSA. Delivery is v2‑only via the runner/iframe architecture using the v2 manifest and bundle.

## Current State
- UI is a mix of JSON descriptors (navigation, settings page) and React pages/components (agreements, statements, details), built with Vite.
- No server WASM handlers are included; descriptor handler stubs are present only for typing.

## Directory Structure
- `manifest.json` — EE v2 bundle manifest (used for runner packaging)
- `src/descriptors/` — JSON descriptors (navigation + settings page)
- `src/components/` — React wrappers and UI pieces referenced by descriptors
- `src/pages/` — React pages (Agreements, Agreement Detail, Statements, Statement Detail, Settings)
- `vite.config.ts` — Default build (ESM, externals)
- `vite.browser.config.ts` — Browser‑external React build

## Build
- Install root dependencies (ensures `@alga/ui-kit`):
  - `npm install`
- Build outputs (ES modules under `dist/`):
  - `cd ee/extensions/softwareone-ext`
  - `npm run build`
  - Produces `dist/{components,pages}/**.js` plus shared modules
  - Externalizes: `react`, `react-dom`, `react-router-dom`, `formik`, `yup`, `@tanstack/react-query`
  - Optional: browser‑external build → `npx vite build -c vite.browser.config.ts`

## Develop
- Watch build: `npm run build -- --watch`
- Vite dev server (for UI iteration): `npm run dev`

## Host Integration
- Install via v2 registry and serve UI through the runner iframe per the v2 docs.

## Packaging (EE v2, optional)
This project includes a v2 `manifest.json` and tools to produce a content‑addressed bundle for the EE runner.

- Pack from project (stages then packs):
  - `node ee/tools/ext-bundle/pack-project.ts --project ee/extensions/softwareone-ext --out dist/softwareone/bundle.tar.zst`
  - Stages `manifest.json`, and includes `ui/` + `dist/` if present, then packs using `pack.ts`.
  - Overwrite existing bundle: append `--force` (otherwise you’ll be prompted in interactive shells)
- Result artifacts: `dist/softwareone/bundle.tar.zst` and `dist/softwareone/bundle.sha256`

## Known Limitations
- Descriptor handlers are placeholders; no server execution environment is included here.
- Settings is fully descriptor‑driven; other routes provide React pages that can be wired via descriptors/wrappers.
- EE runner + iframe delivery requires a v2 bundle and server support.

## References
- EE Overview: `ee/docs/extension-system/overview.md`
- Development Guide: `ee/docs/extension-system/development_guide.md`
- Example Bundle: `ee/docs/examples/extension-bundle-v2`

## License
Proprietary. See `ee/LICENSE.md`.
