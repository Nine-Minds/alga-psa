This directory contains a precompiled JavaScript-based WebAssembly component used by the
container integration tests. The component exports the `runner::handler` implementation
and returns a simple JSON payload echoing request metadata.

Generated from `ee/runner/tests/fixtures/js-component-src` using:

```
npm install
npm run component
```

The build requires the `@bytecodealliance/componentize-js` toolchain and the repo's
`ee/runner/wit/extension-runner.wit` definition. After rebuilding, copy the resulting
`dist/component.wasm` into this directory.
