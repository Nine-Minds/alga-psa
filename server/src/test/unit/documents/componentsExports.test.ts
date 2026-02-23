import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('documents component exports', () => {
  it('exports CollaborativeEditor', () => {
    const indexPath = resolve(__dirname, '../../../../../packages/documents/src/components/index.ts');
    const contents = readFileSync(indexPath, 'utf8');

    expect(contents).toContain('CollaborativeEditor');
  });
});
