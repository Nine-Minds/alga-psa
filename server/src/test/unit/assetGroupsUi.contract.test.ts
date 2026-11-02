import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T106-T115 — F071-F079: the group surfaces. Source-level, for the same reason
 * as the RMM mapping managers: these components span four packages with no
 * shared mount harness, and the failure mode worth guarding is structural —
 * a tile, column or dialog that is declared but never wired to its data.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('asset group surfaces', () => {
  it('T106: the Bento Group tile renders kind, siblings and people, and only when grouped', () => {
    const text = source('packages/assets/src/components/AssetBentoLayout.tsx');
    const tile = text.slice(text.indexOf('id="asset-bento-group"'), text.indexOf('id="asset-bento-related'));

    expect(tile).toMatch(/asset\.group/);
    expect(tile).toMatch(/member_count|assetGroups\.(siblings|members)/);
    expect(tile).toMatch(/user_count|assetGroups\.people/);
    expect(tile).toContain('id="asset-bento-group-open"');
    // Guarded on asset.group, so an ungrouped asset shows no tile.
    expect(text).toMatch(/\{asset\.group \?[\s\S]{0,200}id="asset-bento-group"/);

    // The siblings are links, and the people are named — the summary on the
    // asset only counts them, so the tile fetches the group itself.
    expect(text).toMatch(/\['asset', asset\.asset_id, 'group', asset\.group\.group_id\]/);
    expect(text).toMatch(/unwrapAssetActionResult\(getAssetGroup\(groupId as string\)\)/);
    expect(tile).toMatch(/groupSiblings\.slice\(0, 5\)/);
    expect(tile).toMatch(/href=\{`\/msp\/assets\/\$\{member\.asset_id\}`\}/);
    expect(tile).toMatch(/groupPeople[\s\S]{0,200}contact\.contact_name/);
  });

  it('T107: an ungrouped asset gets Add to group in the Related assets tile', () => {
    const text = source('packages/assets/src/components/AssetBentoLayout.tsx');

    expect(text).toMatch(/\{!asset\.group \?[\s\S]{0,300}id="asset-bento-add-to-group"/);
    expect(text).toContain("t('assetGroups.actions.addToGroup'");
  });

  it('T108/T109/T110: the group drawer has members, people, owner and the destructive confirms', () => {
    const text = source('packages/assets/src/components/groups/AssetGroupDrawer.tsx');

    expect(text).toContain('id="asset-group-add-assets"');
    // F072: the picker must exclude assets already in a group, or the UNIQUE
    // on (tenant, asset_id) turns a click into a 500. The flag is passed here
    // and translated into the `ungrouped_only` list filter by the picker.
    expect(text).toMatch(/<ClientAssetMultiSelect[\s\S]{0,400}excludeGrouped/);
    expect(source('packages/assets/src/components/ClientAssetMultiSelect.tsx'))
      .toContain('...(excludeGrouped ? { ungrouped_only: true } : {}),');
    expect(text).toContain('id="asset-group-owner-picker"');
    expect(text).toContain('id="asset-group-add-user-picker"');
    expect(text).toContain('id="asset-group-confirm-unassign-dialog"');
    expect(text).toContain('id="asset-group-confirm-kind-dialog"');
    expect(text).toContain('id="asset-group-confirm-delete-dialog"');
  });

  it('T111: the client Assets tab has the Assets | Groups views and New group', () => {
    const text = source('packages/msp-composition/src/clients/MspClientAssets.tsx');

    expect(text).toMatch(/listAssetGroups\(clientId\)/);
    expect(text).toContain('id="client-assets-new-group"');
    expect(text).toContain('id="client-assets-new-group-dialog"');
    expect(text).toContain('id="client-asset-groups-table"');
    expect(text).toMatch(/createAssetGroup/);
    // F071's "Add to group" links here with ?view=groups; the tab has to open
    // on the view it was sent to, not on Assets.
    expect(text).toMatch(/searchParams\?\.get\('view'\) === 'groups' \? 'groups' : 'assets'/);
  });

  it('T111: a group write reloads the Assets table it just reassigned', () => {
    const text = source('packages/msp-composition/src/clients/MspClientAssets.tsx');

    // The table's rows live in state loaded per filter, so a bundle owner
    // change made in the drawer left the old assignee on screen until a full
    // reload. The drawer reports every write; the tab refetches both views.
    expect(text).toMatch(/const refreshAfterGroupChange = useCallback\(\(\) => \{\s*void loadData\(\);\s*void loadGroups\(\);/);
    expect(text).toMatch(/<AssetGroupDrawer[\s\S]{0,200}onChanged=\{refreshAfterGroupChange\}/);
    expect(text).toMatch(/onDeleted=\{\(\) => \{ setOpenGroupId\(null\); refreshAfterGroupChange\(\); \}\}/);
    // Stable identity, or the drawer refetches its group on every render.
    expect(text).toMatch(/\}, \[loadData, loadGroups\]\);/);
  });

  it('T112/T113: the list has bulk Add to group and a working Group filter and column', () => {
    const text = source('packages/assets/src/components/AssetDashboardClient.tsx');

    expect(text).toContain('id="bulk-add-to-group"');
    expect(text).toContain('group_id: groupFilter || undefined');
    // F075: the Group column reads `record.group`, which listAssets must fill.
    expect(text).toMatch(/record\.group\?\.name/);
  });

  it('T113: listAssets populates the group the column reads', () => {
    const text = source('packages/assets/src/actions/assetActions.ts');

    expect(text).toMatch(/getAssetGroupSummariesForAssets\(\s*trx,\s*tenant,/);
    expect(text).toContain('group: groupSummaries.get(asset.asset_id) ?? null,');
    // And the filter the column pairs with, now in the shared list-filter builder.
    expect(text).toContain('applyAssetListFilters(query, { trx, tenant, params: validatedParams });');
    expect(source('packages/assets/src/lib/assetListFilters.ts')).toMatch(/if \(params\.group_id\)/);
  });

  it('T114: a shared-workspace member shows the workspace line instead of Assign', () => {
    const text = source('packages/assets/src/components/AssetAssigneeRow.tsx');

    // Early return before any Assign affordance is rendered.
    const workspaceBranch = text.slice(text.indexOf('if (sharedWorkspace) {'));
    expect(workspaceBranch).toContain("t('assetBento.sharedWorkspaceValue'");
    const beforeAssign = text.indexOf('if (sharedWorkspace) {');
    const assignButton = text.indexOf('asset-assign-button');
    expect(beforeAssign).toBeGreaterThanOrEqual(0);
    expect(assignButton).toBeGreaterThan(beforeAssign);
  });

  it('T115: the contact page lists the shared workspaces the contact uses', () => {
    const text = source('packages/assets/src/components/ContactAssetsSection.tsx');

    expect(text).toMatch(/getContactSharedWorkspaces\(cid\)/);
    expect(text).toContain("t('contactAssets.sharedWorkspaces'");
    // And the section has to be mounted on the contact page to be reachable.
    expect(source('server/src/app/msp/contacts/[id]/page.tsx'))
      .toContain('<ContactAssetsSection contactId={contact.contact_name_id} />');
  });

  it('T116: the timeline renders group entries', () => {
    const text = source('packages/assets/src/components/AssetTimeline.tsx');

    expect(text).toContain('group_added');
    expect(text).toContain('group_removed');
  });
});
