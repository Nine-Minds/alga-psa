import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './QuickAddTicket.tsx'),
  'utf8',
);

describe('QuickAddTicket asset link pill contract', () => {
  it('accepts an optional assetName prop alongside assetId', () => {
    expect(source).toMatch(/assetName\?:\s*string/);
    expect(source).toMatch(/assetId\?:\s*string/);
  });

  it('renders an asset-link pill (not a full-width Alert) whenever an assetId is provided', () => {
    expect(source).toContain('quick-add-ticket-asset-pill');
    expect(source).toMatch(/<Badge\b/);
    expect(source).toMatch(/\{assetId &&/);
    expect(source).toContain("'create.linkedToAsset'");
    expect(source).toContain("'create.linkedToAssetGeneric'");
  });
});
