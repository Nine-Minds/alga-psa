import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAllSourceFiles } from '../../packages/build-tools/tsup-preset';

describe('shared tsup preset', () => {
  it('uses glob-compatible entry paths for source files on every platform', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-tsup-entries-'));
    try {
      fs.mkdirSync(path.join(root, 'nested'));
      fs.writeFileSync(path.join(root, 'index.ts'), '');
      fs.writeFileSync(path.join(root, 'nested', 'widget.tsx'), '');
      fs.writeFileSync(path.join(root, 'nested', 'data.json'), '{}');
      fs.writeFileSync(path.join(root, 'nested', 'widget.test.ts'), '');

      const entries = Object.values(getAllSourceFiles(root));
      expect(entries).toHaveLength(3);
      expect(entries).toEqual(expect.arrayContaining([
        expect.stringMatching(/\/index\.ts$/),
        expect.stringMatching(/\/nested\/widget\.tsx$/),
        expect.stringMatching(/\/nested\/data\.json$/),
      ]));
      expect(entries.every(entry => !entry.includes('\\'))).toBe(true);
      expect(entries.every(entry => fs.existsSync(entry))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
