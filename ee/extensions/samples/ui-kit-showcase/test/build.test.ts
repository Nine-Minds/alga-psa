import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

describe('build output', () => {
  test('iframe bundle is generated in ui/dist/iframe', () => {
    const bundlePath = path.join(root, 'ui', 'dist', 'iframe', 'main.js');
    expect(fs.existsSync(bundlePath)).toBe(true);
  });
});
