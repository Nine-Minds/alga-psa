/**
 * Regression: the asset detail page renders entirely from the client-side
 * `['asset', id, ...]` SWR cache, so a write that does not drop those keys
 * leaves its tiles on the pre-save values until a full page reload. Saving a
 * status and moving a bundle's location both did exactly that.
 *
 * Asserted at the source level because the alternative is mounting the edit
 * form and the group drawer with a live SWR provider for one call each.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(__dirname, file), 'utf8');

describe('asset writers drop the asset cache', () => {
  it('the edit form invalidates the saved asset', () => {
    const source = read('AssetForm.tsx');
    expect(source).toMatch(/mutateCache\(matchAssetCacheKeys\(\[assetId\]\)\)/);
  });

  it('the group drawer invalidates the members it moved', () => {
    const source = read('groups/AssetGroupDrawer.tsx');
    expect(source).toMatch(/matchAssetCacheKeys\(\[\.\.\.memberIds, \.\.\.after\]\)/);
    // Every write goes through `run`, and deleting the group goes its own way.
    // `run` also tells the parent, so a list rendered behind the drawer
    // reloads the rows this write just reassigned; the first read does not,
    // or opening the drawer would reload that list for nothing.
    expect(source).toMatch(
      /const result = await work\(\);\s*const applied = apply\(result\);\s*if \(applied\) onChanged\?\.\(applied\);\s*revalidateMembers\(result\);/
    );
    expect(source).toMatch(/revalidateMembers\(\);\s*onDeleted\?\.\(\)/);
    expect(source).toMatch(/const apply = useCallback\([\s\S]{0,400}\}, \[\]\);/);
  });

  it('the assignee row invalidates the asset it reassigned', () => {
    const source = read('AssetAssigneeRow.tsx');
    expect(source).toMatch(/mutate\(matchAssetCacheKeys\(\[assetId\]\)\)/);
  });
});
