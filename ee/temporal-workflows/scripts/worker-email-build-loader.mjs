import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeFixture = fileURLToPath(new URL('./worker-email-test-runtime.mjs', import.meta.url));

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (resolved.url.endsWith('/dist/packages/db/src/index.js')) {
      return { url: pathToFileURL(runtimeFixture).href, shortCircuit: true };
    }
    return resolved;
  },
});
