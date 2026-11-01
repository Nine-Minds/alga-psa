import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { orderEntityAssetIds } from './entityAssetOrder';

const INITIAL_DISPLAY_COUNT = 2; // AssociatedAssets collapsed rows

describe('orderEntityAssetIds', () => {
  it('puts the newest association first so a just-received item is in the visible rows', () => {
    const ordered = orderEntityAssetIds(
      [
        { asset_id: 'a-old', created_at: '2026-10-01T00:00:00Z' },
        { asset_id: 'a-mid', created_at: new Date('2026-10-10T00:00:00Z') },
        { asset_id: 'a-received', created_at: '2026-10-25T16:00:00Z' },
      ],
      ['a-old', 'a-mid', 'a-received'],
    );
    expect(ordered.slice(0, INITIAL_DISPLAY_COUNT)).toContain('a-received');
    expect(ordered[0]).toBe('a-received');
  });

  it('drops unauthorized ids, dedupes, and breaks ties by asset_id', () => {
    const t = '2026-10-25T00:00:00Z';
    expect(
      orderEntityAssetIds(
        [{ asset_id: 'b', created_at: t }, { asset_id: 'a', created_at: t }, { asset_id: 'x', created_at: t }, { asset_id: 'a', created_at: t }],
        ['a', 'b'],
      ),
    ).toEqual(['a', 'b']);
  });

  it('listEntityAssets orders associations newest-first in SQL and applies the helper', () => {
    const src = readFileSync(resolve(__dirname, '../actions/assetActions.ts'), 'utf8');
    const start = src.indexOf('export const listEntityAssets');
    const body = src.slice(start, src.indexOf('Error listing entity assets', start));
    expect(body).toContain("column: 'created_at', order: 'desc'");
    expect(body).toContain('orderEntityAssetIds(');
  });
});
