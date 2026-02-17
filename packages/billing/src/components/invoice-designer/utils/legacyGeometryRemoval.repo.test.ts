import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../..');

const repoFile = (relativePath: string) => path.resolve(repoRoot, relativePath);

const walkFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
};

describe('invoice designer legacy geometry removal', () => {
  it('removes PRD-listed geometry utility modules from the repo', () => {
    const removedFiles = [
      'packages/billing/src/components/invoice-designer/utils/constraintSolver.ts',
      'packages/billing/src/components/invoice-designer/utils/constraints.ts',
      'packages/billing/src/components/invoice-designer/utils/dropParentResolution.ts',
      'packages/billing/src/components/invoice-designer/utils/aspectRatio.ts',
    ];

    removedFiles.forEach((file) => {
      expect(fs.existsSync(repoFile(file))).toBe(false);
    });
  });

  it('keeps invoice designer source free of imports to removed geometry utilities', () => {
    const forbiddenSubstrings = [
      'utils/constraintSolver',
      'utils/constraints',
      'utils/dropParentResolution',
      'utils/aspectRatio',
    ];

    const invoiceDesignerRoot = repoFile('packages/billing/src/components/invoice-designer');
    const files = walkFiles(invoiceDesignerRoot).filter((file) => {
      const isTs = file.endsWith('.ts') || file.endsWith('.tsx');
      const isTest = file.endsWith('.test.ts') || file.endsWith('.test.tsx') || file.endsWith('.spec.ts') || file.endsWith('.spec.tsx');
      return isTs && !isTest;
    });

    files.forEach((file) => {
      const source = fs.readFileSync(file, 'utf8');
      forbiddenSubstrings.forEach((substring) => {
        expect(source).not.toContain(substring);
      });
    });
  });
});

