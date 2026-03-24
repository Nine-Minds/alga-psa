import { defineConfig } from 'tsup';
import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

function getAllSourceFiles(dir: string, base: string = dir): Record<string, string> {
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

// Add .js extensions to relative imports for Node.js ESM compatibility
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

export default defineConfig({
  entry: getAllSourceFiles('src'),
  format: ['esm'],
  dts: false,
  bundle: false,
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  external: [
    /^@alga-psa\//,
    /^@shared\//,
  ],
  onSuccess: async () => {
    addJsExtensions('dist');
  },
});
