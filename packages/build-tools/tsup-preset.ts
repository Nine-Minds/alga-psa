/**
 * Shared tsup preset for pre-built @alga-psa/* packages.
 *
 * Compiles every .ts/.tsx file under src/ individually (bundle: false)
 * so webpack aliases like '@alga-psa/foo/actions/bar' resolve to dist/.
 *
 * Types are NOT emitted (dts: false) — TypeScript resolves types from
 * src/ via tsconfig paths; only webpack reads from dist/.
 *
 * Options.jsxEnabled: turn on for packages with .tsx files (React components).
 * Options.addJsExtensions: turn on for packages imported directly by Node.js
 *   (not via webpack), e.g. Temporal workers. Rewrites relative imports to
 *   include .js extensions required by Node.js ESM resolution.
 */
import { defineConfig, type Options } from 'tsup';
import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

export function getAllSourceFiles(dir: string, base: string = dir): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const file of readdirSync(dir)) {
    const fullPath = join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      Object.assign(entries, getAllSourceFiles(fullPath, base));
    } else if (
      /\.(ts|tsx)$/.test(file) &&
      !file.endsWith('.d.ts') &&
      !file.endsWith('.test.ts') &&
      !file.endsWith('.test.tsx') &&
      !file.endsWith('.spec.ts') &&
      !file.endsWith('.spec.tsx')
    ) {
      const relPath = relative(base, fullPath).replace(/\.(ts|tsx)$/, '');
      entries[relPath] = fullPath;
    }
  }
  return entries;
}

/** Rewrite relative imports in dist/ to add .js extensions for Node.js ESM. */
function addJsExtensions(dir: string) {
  for (const file of readdirSync(dir)) {
    const fullPath = join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      addJsExtensions(fullPath);
    } else if (file.endsWith('.js')) {
      const content = readFileSync(fullPath, 'utf-8');
      const fixed = content.replace(
        /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
        (match, pre, path, post) => {
          if (path.endsWith('.js') || path.endsWith('.json')) return match;
          return `${pre}${path}.js${post}`;
        }
      );
      if (fixed !== content) writeFileSync(fullPath, fixed);
    }
  }
}

interface PresetOptions {
  /** Extra externals beyond the default @alga-psa/* and @shared/* patterns. */
  external?: (string | RegExp)[];
  /** Enable JSX transform for packages with .tsx files (default: false). */
  jsxEnabled?: boolean;
  /** Rewrite relative imports to add .js extensions for Node.js ESM (default: false). */
  addJsExtensions?: boolean;
}

export function makeConfig(opts: PresetOptions = {}): Options {
  const external: (string | RegExp)[] = [
    /^@alga-psa\//,
    /^@shared\//,
    ...(opts.external ?? []),
  ];

  const config: Options = {
    entry: getAllSourceFiles('src'),
    format: ['esm'],
    dts: false,
    bundle: false,
    splitting: false,
    sourcemap: false,
    clean: true,
    outDir: 'dist',
    external,
    outExtension() {
      return { js: '.js' };
    },
  };

  if (opts.jsxEnabled) {
    config.esbuildOptions = (options) => {
      options.jsx = 'automatic';
    };
  }

  if (opts.addJsExtensions) {
    config.onSuccess = async () => {
      addJsExtensions('dist');
    };
  }

  return config;
}
