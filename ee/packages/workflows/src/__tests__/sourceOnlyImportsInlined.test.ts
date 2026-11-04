import { describe, expect, it } from 'vitest';
import { build, type Plugin } from 'esbuild';
import path from 'node:path';
import tsupConfig from '../../tsup.config';
import { SOURCE_ONLY_ALGA_IMPORTS } from '../../../../../shared/tsup.sourceOnlyImports';

/**
 * The workflow runtime bundles shared/workflow source by relative path, so a
 * source-only `@alga-psa/*` import left external survives into dist and fails
 * to load under native Node (the workflow-worker imports dist/runtime/core.mjs).
 * This bundles the runtime entry with this package's tsup external/noExternal
 * rules and checks no source-only specifier remains a runtime import.
 */

type Pattern = string | RegExp;
const config = tsupConfig as { external?: Pattern[]; noExternal?: Pattern[] };
const matches = (patterns: Pattern[] | undefined, specifier: string) =>
  (patterns ?? []).some((p) => (typeof p === 'string' ? p === specifier : p.test(specifier)));

// tsup semantics: noExternal wins; otherwise configured externals (and, by
// default, every installed dependency) stay as runtime imports.
const tsupExternals: Plugin = {
  name: 'tsup-externals',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (matches(config.noExternal, args.path)) return undefined;
      return { path: args.path, external: true };
    });
  },
};

describe('workflow runtime bundle', () => {
  it('inlines source-only @alga-psa imports reached through shared workflow source', async () => {
    const packageRoot = path.resolve(__dirname, '../..');
    const result = await build({
      entryPoints: [path.join(packageRoot, 'src/runtime/core.ts')],
      absWorkingDir: packageRoot,
      tsconfig: path.join(packageRoot, 'tsconfig.json'),
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
      plugins: [tsupExternals],
    });

    const runtimeImports = Object.values(result.metafile.outputs)
      .flatMap((output) => output.imports.filter((entry) => entry.external).map((entry) => entry.path));

    expect(runtimeImports.some((specifier) => matches(config.external, specifier))).toBe(true);
    expect(runtimeImports.filter((specifier) => matches(SOURCE_ONLY_ALGA_IMPORTS, specifier))).toEqual([]);
    expect(result.outputFiles[0].text).toContain('function isCoManagedLifecycleError');
  }, 120_000);
});
