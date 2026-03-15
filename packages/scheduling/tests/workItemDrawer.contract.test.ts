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
  it('uses the canonical ticket, interaction, and task detail components instead of scheduling-specific summaries', () => {
    const source = readWorkItemDrawerSource();

    expect(source).toContain("import InteractionDetails from '@alga-psa/clients/components/interactions/InteractionDetails'");
    expect(source).toContain("import TicketDetails from '@alga-psa/tickets/components/ticket/TicketDetails'");
    expect(source).toContain("import TaskEdit from '@alga-psa/projects/components/TaskEdit'");

    expect(source).toContain('getConsolidatedTicketData(workItem.work_item_id)');
    expect(source).toContain('getInteractionById(workItemId)');
    expect(source).toContain('getTaskById(workItem.work_item_id)');

    expect(source).not.toContain('SchedulingTicketDetails');
    expect(source).not.toContain('SchedulingInteractionDetails');
    expect(source).not.toContain('SchedulingProjectTaskDetails');
  });
});
