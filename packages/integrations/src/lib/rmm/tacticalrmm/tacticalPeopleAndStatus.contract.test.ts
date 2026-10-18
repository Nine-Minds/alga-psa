import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FR-D8 / FR-B6 for Tactical.
 *
 * The Tactical mapping UI offers the People mode and the action stores it, but
 * Tactical writes assets through its own sync rather than the shared
 * ingestion service — so "auto" did nothing at all. Its create path also
 * hard-coded `status: 'active'` and nothing ever retired a device Tactical had
 * forgotten.
 */
const deviceSync = fs.readFileSync(path.resolve(__dirname, './deviceSync.ts'), 'utf8');
const singleAgent = fs.readFileSync(path.resolve(__dirname, './syncSingleAgent.ts'), 'utf8');

describe('Tactical honours the people mode', () => {
  it('reads the organization mode and assigns after the extension row', () => {
    expect(deviceSync).toContain("from '@alga-psa/shared/rmm/autoAssignFromSignedInUser'");
    expect(deviceSync).toContain("'contact_assignment_mode'");
    expect(deviceSync).toContain('mode: assignmentMode');
    // Both the create and the update path.
    expect(deviceSync.match(/await applyRmmSignedInUserAssignment\(knex, \{/g)).toHaveLength(2);
    // The asset's own client wins, because FR-G5 keeps a manual move.
    expect(deviceSync).toContain('const assignmentClientId = assetRow?.client_id');
  });

  it('the single-agent refresh assigns too', () => {
    expect(singleAgent).toContain("from '@alga-psa/shared/rmm/autoAssignFromSignedInUser'");
    expect(singleAgent).toContain('await applyRmmSignedInUserAssignment(knex, {');
    expect(singleAgent).toContain("mode: orgMapping.contact_assignment_mode ?? 'suggest'");
  });
});

describe('Tactical lifecycle status', () => {
  it('sets the status once, from the agent connectivity', () => {
    expect(deviceSync).toContain("status: args.status ?? 'active'");
    expect(deviceSync).toContain("status: status === 'offline' ? 'inactive' : 'active'");
  });

  it('retires a device Tactical no longer lists, on a full sync only', () => {
    expect(deviceSync).toContain('async function retireVanishedTacticalAssets(');
    expect(deviceSync).toContain('if (!args.isFullSync || args.seenAgentIds.length === 0) return 0;');
    expect(deviceSync).toContain("status: 'retired',");
    expect(deviceSync).toContain('items_deleted: deleted,');
    // The update path never re-stamps the lifecycle status (FR-B6).
    const updateBlock = deviceSync.slice(deviceSync.indexOf('const assetIdText = String(mapping.alga_entity_id);'));
    expect(updateBlock.slice(0, 1200)).not.toMatch(/\n\s+status: /);
  });
});
