import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const coreDir = path.resolve(serverDir, '../packages/core');

// Candidates the '@alga-psa/core/' prefix alias ('../packages/core/src/') can
// land on for an export named <name>.
const MIRROR_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function coreSubpathExports(): Array<{ name: string; typesPath: string }> {
  const pkg = JSON.parse(fs.readFileSync(path.join(coreDir, 'package.json'), 'utf8')) as {
    exports: Record<string, { types?: string }>;
  };

  return Object.entries(pkg.exports)
    .filter(([key]) => key !== '.')
    .map(([key, entry]) => {
      if (!entry?.types) {
        throw new Error(`@alga-psa/core export '${key}' has no "types" field`);
      }
      return {
        name: key.replace(/^\.\//, ''),
        typesPath: entry.types.replace(/^\.\//, ''),
      };
    });
}

describe('@alga-psa/core Turbopack alias contract', () => {
  it('resolves every core subpath export from source in next dev', async () => {
    const { default: nextConfig } = await import('../../../next.config.mjs');
    const resolveAlias = (nextConfig.turbopack?.resolveAlias ?? {}) as Record<string, string>;

    for (const { name, typesPath } of coreSubpathExports()) {
      const mirrored = MIRROR_SUFFIXES.some((suffix) =>
        fs.existsSync(path.join(coreDir, 'src', `${name}${suffix}`))
      );
      if (mirrored) {
        continue;
      }

      const aliasKey = `@alga-psa/core/${name}`;
      expect(
        resolveAlias[aliasKey],
        `${aliasKey} resolves to ${typesPath}, which has no src/ mirror, so the ` +
          `'@alga-psa/core/' prefix alias cannot find it. Add an explicit ` +
          `turbopack.resolveAlias entry in server/next.config.mjs.`
      ).toBe(`../packages/core/${typesPath}`);

      expect(
        fs.existsSync(path.join(coreDir, typesPath)),
        `${aliasKey} is aliased to ${typesPath}, which does not exist on disk`
      ).toBe(true);
    }
  });
});
