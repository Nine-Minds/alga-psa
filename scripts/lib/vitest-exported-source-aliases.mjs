import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Exact-match Vite aliases for every subpath a workspace package exports, read from its own `exports` map
 * (each entry's `types` is its source file). Tests then resolve a subpath exactly as the package publishes it,
 * instead of through a guessed directory pattern (`@alga-psa/core/* -> src/lib/*`) that silently misses entries
 * living elsewhere, such as `@alga-psa/core/config/deletion`. Place these before any catch-all pattern.
 *
 * @param {string} packageName e.g. `@alga-psa/core`
 * @param {string} packageDir absolute path of the package directory
 * @returns {{ find: RegExp, replacement: string }[]}
 */
export function exportedSourceAliases(packageName, packageDir) {
  const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  return Object.entries(manifest.exports ?? {})
    .filter(([subpath, entry]) => subpath !== '.' && typeof entry?.types === 'string' && entry.types.startsWith('./src/'))
    .map(([subpath, entry]) => ({
      find: new RegExp(`^${`${packageName}${subpath.slice(1)}`.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`),
      replacement: path.resolve(packageDir, entry.types),
    }));
}
