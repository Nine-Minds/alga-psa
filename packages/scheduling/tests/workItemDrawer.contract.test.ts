import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readWorkItemDrawerSource(): string {
  const filePath = path.resolve(
    __dirname,
    '../src/components/time-management/time-entry/time-sheet/WorkItemDrawer.tsx'
  );

  return fs.readFileSync(filePath, 'utf8');
}

describe('WorkItemDrawer full detail wiring', () => {
  it('uses the cross-feature context to access ticket, interaction, and task details', () => {
    const source = readWorkItemDrawerSource();

    // Uses the composition-layer context instead of direct cross-package imports
    expect(source).toContain('useSchedulingCrossFeature');
    expect(source).toContain("from '../../../../context/SchedulingCrossFeatureContext'");

    // Still delegates to the canonical data-fetching and rendering calls
    expect(source).toContain('getConsolidatedTicketData(workItem.work_item_id)');
    expect(source).toContain('getInteractionById(workItemId)');
    expect(source).toContain('getTaskById(workItem.work_item_id)');
    expect(source).toContain('renderTicketDetails');
    expect(source).toContain('renderInteractionDetails');
    expect(source).toContain('renderTaskEdit');

    // No direct cross-package imports
    expect(source).not.toContain("from '@alga-psa/clients");
    expect(source).not.toContain("from '@alga-psa/tickets");
    expect(source).not.toContain("from '@alga-psa/projects");

    // No scheduling-specific summary components
    expect(source).not.toContain('SchedulingTicketDetails');
    expect(source).not.toContain('SchedulingInteractionDetails');
    expect(source).not.toContain('SchedulingProjectTaskDetails');
  });
});
