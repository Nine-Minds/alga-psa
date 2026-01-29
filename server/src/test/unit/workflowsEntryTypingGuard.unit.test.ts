import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('workflows entry typing guards', () => {
  it('does not reintroduce tsconfig paths for @alga-psa/workflows/entry', () => {
    const serverTsconfig = fs.readFileSync(path.resolve(__dirname, '../../../tsconfig.json'), 'utf8');
    expect(serverTsconfig).not.toContain('"@alga-psa/workflows/entry"');

    const eeServerTsconfig = fs.readFileSync(path.resolve(__dirname, '../../../../ee/server/tsconfig.json'), 'utf8');
    expect(eeServerTsconfig).not.toContain('"@alga-psa/workflows/entry"');
  });

  it('provides a d.ts module declaration for @alga-psa/workflows/entry', () => {
    const declarations = fs.readFileSync(
      path.resolve(__dirname, '../../types/external-modules.d.ts'),
      'utf8'
    );
    expect(declarations).toContain("declare module '@alga-psa/workflows/entry'");
  });
});

