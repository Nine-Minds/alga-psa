/**
 * Loads a Node.js builtin module at call time.
 *
 * No `node:` specifier is ever part of a static import graph, so bundlers
 * (webpack/turbopack in source mode, tsup in dist mode) never try to include
 * `node:fs`/`node:path`/`node:crypto` in client bundles — the invariant the
 * filesystem secret provider relies on to keep Node builtins out of static Next
 * client graphs. Only this module touches builtins, and only when a secret is
 * actually read or written.
 *
 * Prefers `process.getBuiltinModule` (Node >= 20.16 / 22.3): it is synchronous,
 * and it works from sandboxed runtimes such as vitest's VM-evaluated forks,
 * which provide no dynamic-import callback for `new Function`-created functions
 * (so a plain `new Function('return import(s)')` rejects there). Falls back to
 * a native dynamic import for older Node and non-Node runtimes.
 *
 * The resolved module is cached by the callers (see `getFs`/`getPath`/`getCrypto`
 * in fsSecretCore.ts); Node caches the builtin itself.
 */
export function loadBuiltin<T>(specifier: string): Promise<T> {
  const getBuiltin =
    typeof process !== 'undefined'
      ? (process as { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule
      : undefined;
  if (typeof getBuiltin === 'function') {
    return Promise.resolve(getBuiltin(specifier) as T);
  }
  const importer = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<T>;
  return importer(specifier);
}
