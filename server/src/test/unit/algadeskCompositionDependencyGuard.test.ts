import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const repoRoot = path.resolve(process.cwd(), '..');
const packageRoot = path.join(repoRoot, 'packages/algadesk-composition');
const packageJsonPath = path.join(packageRoot, 'package.json');
const srcRoot = path.join(packageRoot, 'src');

const blockedPackagePatterns = [
  '@alga-psa/billing',
  '@alga-psa/projects',
  '@alga-psa/assets',
  '@alga-psa/scheduling',
  '@alga-psa/sla',
  '@alga-psa/workflow',
  '@alga-psa/surveys',
  '@alga-psa/product-extensions',
  '@alga-psa/product-chat',
  '@alga-psa/reporting',
];

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('Algadesk composition dependency guard', () => {
  it('T004/F043-F050: package exists with constrained dependency surface', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name: string;
      exports: Record<string, unknown>;
      dependencies?: Record<string, string>;
    };

    expect(pkg.name).toBe('@alga-psa/algadesk-composition');
    expect(pkg.exports).toMatchObject({
      './msp': expect.any(Object),
      './portal': expect.any(Object),
      './tickets': expect.any(Object),
      './clients': expect.any(Object),
      './settings': expect.any(Object),
      './kb': expect.any(Object),
      './providers': expect.any(Object),
    });

    const depKeys = Object.keys(pkg.dependencies ?? {});
    for (const blocked of blockedPackagePatterns) {
      expect(depKeys).not.toContain(blocked);
    }
  });

  it('T004/F051-F059: source imports do not pull blocked PSA domains', () => {
    const files = walkTsFiles(srcRoot);
    const sources = files.map((f) => readFileSync(f, 'utf8')).join('\n');

    for (const blocked of blockedPackagePatterns) {
      expect(sources).not.toContain(blocked);
    }

    expect(sources).not.toContain('@alga-psa/extensions');
    expect(sources).not.toContain('@alga-psa/documents');
  });
});
