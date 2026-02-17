import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const thisDir = path.dirname(fileURLToPath(import.meta.url));

const walkFiles = (dir: string): string[] => {
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
      continue;
    }
    out.push(full);
  }
  return out;
};

describe('hierarchy rules (schema-only)', () => {
  it('does not include the legacy state/hierarchy.ts module and no file references it', () => {
    const removedModulePath = path.resolve(thisDir, 'hierarchy.ts');
    expect(fs.existsSync(removedModulePath)).toBe(false);

    const invoiceDesignerDir = path.resolve(thisDir, '..');
    const files = walkFiles(invoiceDesignerDir).filter((file) => /\.(ts|tsx)$/.test(file));

    const offenders: Array<{ file: string; snippet: string }> = [];
    for (const file of files) {
      if (file === path.resolve(thisDir, 'hierarchyRemoval.test.ts')) continue;
      const content = fs.readFileSync(file, 'utf8');
      // Only treat actual import paths as offenders (avoid false positives in comments/strings).
      const match = content.match(/from\s+['"][^'"]*state\/hierarchy[^'"]*['"]/);
      if (match?.index != null) {
        const index = match.index;
        offenders.push({
          file,
          snippet: content.slice(Math.max(0, index - 30), index + 60),
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
