import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);
const designerRoot = path.resolve(thisDir, '..');
const removedCatalogPath = path.resolve(thisDir, 'templateVariableCatalog.ts');

const listDesignerSourceFiles = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listDesignerSourceFiles(fullPath));
      continue;
    }

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
};

describe('invoice template variable catalog removal', () => {
  it('removes static template variable catalog file and source imports', () => {
    expect(existsSync(removedCatalogPath)).toBe(false);

    const references = listDesignerSourceFiles(designerRoot)
      .filter((filePath) => filePath !== thisFile)
      .filter((filePath) => {
        const content = readFileSync(filePath, 'utf8');
        return (
          content.includes('constants/templateVariableCatalog')
          || content.includes('TEMPLATE_VARIABLE_OPTIONS')
        );
      });

    expect(references).toEqual([]);
  });
});
