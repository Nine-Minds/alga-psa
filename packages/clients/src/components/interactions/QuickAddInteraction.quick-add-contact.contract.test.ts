/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('quick add interaction contact creation wiring contract', () => {
  it('T010: QuickAddInteraction wires ContactPicker add-new to QuickAddContact with the selected client id', () => {
    const source = read('./QuickAddInteraction.tsx');

    expect(source).toContain('onAddNew={selectedClientId ? () => setIsQuickAddContactOpen(true) : undefined}');
    expect(source).toContain('isOpen={isQuickAddContactOpen}');
    expect(source).toContain('selectedClientId={selectedClientId}');
  });

  it('T049: Online Meeting quick add is capability-gated and schedules Teams through cross-feature wiring', () => {
    const source = read('./QuickAddInteraction.tsx');

    expect(source).toContain("selectedInteractionType?.type_name === 'Online Meeting'");
    expect(source).toContain('clientCrossFeature?.getTeamsMeetingCapability');
    expect(source).toContain('clientCrossFeature?.scheduleTeamsMeeting');
    expect(source).toContain('teamsMeetingCapability?.available === true');
    expect(source).toContain('id={`${id}-create-teams-meeting-toggle`}');
    expect(source).toContain('clientCrossFeature.scheduleTeamsMeeting!');
    expect(source).toContain('getInteractionById(resultInteraction.interaction_id!)');
  });
});
