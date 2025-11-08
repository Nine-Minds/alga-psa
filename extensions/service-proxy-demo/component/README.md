# service-proxy Component Template

This project was generated with `alga component create`. It targets the Alga extension runner
using the WebAssembly Component Model and [`componentize-js`](https://github.com/bytecodealliance/componentize-js).

## Available scripts

- `npm run build` – transpile TypeScript to ESM and produce a `.wasm` component under `dist/`.
- `npm run clean` – remove build artifacts.

## Project structure

- `src/` – TypeScript sources implementing the `handler` export defined in `wit/extension-runner.wit`.
- `src/types.ts` – convenience copies of the WIT data structures for use in TypeScript.
- `wit/extension-runner.wit` – WIT world definitions describing the host capabilities exposed by the runner.
- `dist/` – build output (`dist/js` for the intermediate JS bundle, `dist/component.wasm` for the component artifact).

## Building

```bash
npm install
npm run build
```

The final component artifact will be written to `dist/component.wasm`. This file, along with the
generated metadata in `dist/component.json`, should be packaged and uploaded via the Alga registry.

## Next steps

- Implement your business logic inside `src/handler.ts`.
- Use the generated helpers in `src/ui-proxy.ts` to interact with host proxy routes instead of storing secrets client-side.
- Add tests (e.g., using Vitest) that exercise your handler logic.
- When ready, run `npm run build` and use `alga pack`/`alga publish` to distribute the component.

