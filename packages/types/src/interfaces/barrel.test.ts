import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('interfaces barrel', () => {
  it('exports every interface file in the public surface', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const interfacesDir = here;
    const indexPath = path.join(interfacesDir, 'index.ts');

    const indexContents = fs.readFileSync(indexPath, 'utf8');
    const exportedBases = new Set<string>();

    for (const match of indexContents.matchAll(/export \* from ['"]\.\/([^'"]+)['"]/g)) {
      exportedBases.add(match[1]);
    }

    for (const match of indexContents.matchAll(
      /export (?:type\s*)?\{[^}]+\}\s*from ['"]\.\/([^'"]+)['"]/g,
    )) {
      exportedBases.add(match[1]);
    }

    const interfaceFiles = fs
      .readdirSync(interfacesDir)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => name !== 'index.ts')
      .filter((name) => name !== 'billingPlan.interface.ts') // Empty placeholder in upstream; not part of public surface.
      .filter((name) => name !== 'email.interfaces.ts') // Avoid collisions with outbound email exports.
      .filter((name) => name !== 'tax.interfaces.ts') // Collides with billing/invoice tax types; not part of public surface.
      .filter((name) => name !== 'authorization.interface.ts') // Deprecated/unused; conflicts with auth exports.
      .filter((name) => !name.includes('.test.')); // Ignore test files.

    const missing: string[] = [];
    for (const file of interfaceFiles) {
      const base = file.replace(/\.(ts|tsx)$/, '');
      if (!exportedBases.has(base)) missing.push(base);
    }

    expect(missing, `Missing exports in interfaces/index.ts: ${missing.join(', ')}`).toEqual([]);

    // Spot-check: exported entries correspond to files present (helps catch typos in index.ts).
    const onDiskBases = new Set(interfaceFiles.map((file) => file.replace(/\.ts$/, '')));
    const stray = [...exportedBases].filter((base) => base !== 'emailProvider.interface' && !onDiskBases.has(base));
    expect(stray, `Stray exports in interfaces/index.ts: ${stray.join(', ')}`).toEqual([]);

    // Ensure the intentional exclusion is still present.
    expect(indexContents).not.toMatch(new RegExp(`export \\* from ['"]\\./${escapeRegExp('email.interfaces')}['"]`));
  });
});
