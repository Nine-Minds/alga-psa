import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, './client-assets.ts'),
  'utf8',
);

describe('client-assets server action contract', () => {
  it('exports a paginated/searchable listClientAssets action', () => {
    expect(source).toContain('export const listClientAssets = withAuth');
    expect(source).toContain('ListClientAssetsResponse');
    expect(source).toContain('total: Number(filteredCount?.count ?? 0)');
  });

  it('returns server-computed per-type counts for the summary tiles', () => {
    expect(source).toContain('by_type: byType');
    expect(source).toContain(".groupBy('asset_type')");
  });

  it('keeps a backwards-compatible getClientAssets export for previews', () => {
    expect(source).toContain('export const getClientAssets = withAuth');
  });

  it('applies pagination via limit/offset', () => {
    expect(source).toContain('.limit(limit)');
    expect(source).toContain('.offset(offset);');
  });

  it('filters by search across name, asset_tag, and serial_number', () => {
    expect(source).toMatch(/LOWER\(name\) LIKE/);
    expect(source).toMatch(/LOWER\(asset_tag\) LIKE/);
    expect(source).toMatch(/LOWER\(serial_number\) LIKE/);
  });

  it('caps limit to a sensible maximum', () => {
    expect(source).toMatch(/MAX_LIMIT/);
  });

  it('still scopes queries by tenant + the resolved client_id', () => {
    expect(source).toContain('{ tenant, client_id: clientId }');
  });
});
