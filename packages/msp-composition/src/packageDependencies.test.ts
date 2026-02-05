import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('msp-composition package.json', () => {
  it('includes @alga-psa/scheduling dependency', () => {
    const pkgPath = path.resolve(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.dependencies).toHaveProperty('@alga-psa/scheduling');
  });
});
