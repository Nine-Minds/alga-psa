import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');

const readFile = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), 'utf-8');

describe('DefaultLayout includes MspSchedulingProvider', () => {
  it('wraps DrawerProvider with MspSchedulingProvider in DefaultLayout', () => {
    const content = readFile('server/src/components/layout/DefaultLayout.tsx');
    expect(content).toContain('MspSchedulingProvider');
  });
});
