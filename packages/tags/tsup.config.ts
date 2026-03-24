import { defineConfig } from 'tsup';
import { readdirSync, statSync } from 'fs';
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
    'react',
    'react-dom',
    'next',
    'next/navigation',
    'next/link',
    'next-auth',
    'next-auth/react',
    /^@alga-psa\//,
    /^@shared\//,
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
