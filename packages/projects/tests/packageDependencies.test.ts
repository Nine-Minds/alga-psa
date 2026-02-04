import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('projects package dependencies', () => {
  it('includes @alga-psa/billing (T001)', () => {
    const packageJsonPath = path.resolve(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.['@alga-psa/billing']).toBe('*');
  });
});
