# Build & Publish (@alga/extension-iframe-sdk)

Prereqs:
- Node 18+
- pnpm or npm/yarn

Build:
- `cd packages/extension-iframe-sdk`
- `npm run build` (emits `dist/` with ESM + d.ts)

Publish to npm:
- Ensure `package.json` has `"private": false` and `publishConfig.access: "public"`
- `npm publish --access public`

Notes:
- The package ships unbundled ESM built by TypeScript (no Rollup/tsup). This is suitable for library consumption and tree-shaking.
- Tests (vitest) are configured but not published. Run locally with `npm test`.

