import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the Temporal worker's `@alga-psa/db` source mappings.
 *
 * @alga-psa/db publishes subpaths that do not mirror its source tree
 * (`./commentEventRegistry` -> `src/lib/commentEventRegistry.ts`), while the
 * worker's catch-all alias maps `@alga-psa/db/<x>` to `src/<x>`. A subpath added
 * to the package without a matching worker alias broke collection of every
 * suite reaching shared/models/ticketModel.ts with ERR_MODULE_NOT_FOUND. This
 * imports every published subpath, both bare and in the `.js` form used by
 * runtime code, and checks it is the same module as its source file.
 */
const dbPackageRoot = path.resolve(__dirname, '../../../../packages/db');
const publishedSubpaths = Object.entries(
  JSON.parse(fs.readFileSync(path.join(dbPackageRoot, 'package.json'), 'utf8')).exports as Record<string, { types: string }>,
).filter(([subpath]) => subpath.startsWith('./'));

describe('@alga-psa/db published subpaths resolve to source in the Temporal worker test env', () => {
  it('publishes the comment event registry subpath', () => {
    expect(publishedSubpaths.map(([subpath]) => subpath)).toContain('./commentEventRegistry');
  });

  it.each(publishedSubpaths)('%s', async (subpath, target) => {
    const specifier = `@alga-psa/db/${subpath.slice(2)}`;
    const source = await import(/* @vite-ignore */ path.join(dbPackageRoot, target.types));
    expect(await import(/* @vite-ignore */ specifier)).toBe(source);
    expect(await import(/* @vite-ignore */ `${specifier}.js`)).toBe(source);
  });
});
