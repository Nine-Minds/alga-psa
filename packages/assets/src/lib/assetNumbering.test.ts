import { describe, expect, it } from 'vitest';
import { formatAssetTag, normalizeAssetTag } from './assetNumbering';

describe('asset physical tag formatting', () => {
  it('normalizes lookup identity with the database matching rule', () => {
    expect(normalizeAssetTag('  fts-00042  ')).toBe('FTS-00042');
    expect(normalizeAssetTag('   ')).toBe('');
    expect(normalizeAssetTag('\t')).toBe('\t');
    expect(normalizeAssetTag('ä')).toBe('ä');
  });

  it('formats the allocated tenant value with a separate client prefix', () => {
    expect(formatAssetTag('00042', 'fts-')).toBe('FTS-00042');
    expect(formatAssetTag('00043', null)).toBe('00043');
  });
});
