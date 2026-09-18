import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AssetBentoLayout Notes shell', () => {
  it('delegates the single Notes tile to AssetNotesPanel', () => {
    const source = readFileSync(resolve(__dirname, 'AssetBentoLayout.tsx'), 'utf8');

    expect(source.match(/<AssetNotesPanel\b/g)).toHaveLength(1);
    expect(source).not.toMatch(/<BentoTile[^>]*id="asset-bento-notes"/);
  });
});
