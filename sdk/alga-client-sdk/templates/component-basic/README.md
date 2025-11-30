# __PACKAGE_NAME__ Component Template

This project was generated with `alga create component`. It targets the Alga extension runner
using the WebAssembly Component Model and [`componentize-js`](https://github.com/bytecodealliance/componentize-js).

## Available scripts

- `npm run build` – build the extension using the Alga CLI (compiles TypeScript and produces WASM)
- `npm run pack` – package the extension into a distributable bundle
- `npm run clean` – remove build artifacts

## Project structure

- `src/` – TypeScript sources implementing the `handler` export defined in `wit/extension-runner.wit`.
- `src/types.ts` – convenience copies of the WIT data structures for use in TypeScript.
- `wit/extension-runner.wit` – WIT world definitions describing the host capabilities exposed by the runner.
- `dist/` – build output (`dist/js` for the intermediate JS bundle, `dist/main.wasm` for the component artifact).

## Building

**Using the Alga CLI (recommended):**

```bash
npm install
npm run build    # runs: alga build
```

Or directly with the CLI:

```bash
alga build
```

The final component artifact will be written to `dist/main.wasm`.

## Packaging

```bash
npm run pack     # runs: alga pack
```

This creates a `bundle.tar.zst` archive containing the manifest, WASM component, and any UI assets.

## Next steps

- Implement your business logic inside `src/index.ts`.
- Use the generated helpers in `src/ui-proxy.ts` to interact with host proxy routes instead of storing secrets client-side.
- Add tests (e.g., using Vitest) that exercise your handler logic.
- When ready, run `npm run build` and `npm run pack` to create a distributable bundle.
- Use `alga extension publish` to upload your extension to an Alga instance.

