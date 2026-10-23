import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketListSource(): string {
  return fs.readFileSync(path.resolve(__dirname, './TicketList.tsx'), 'utf8');
}

describe('client portal TicketList status source contract', () => {
  it('T011: the read filter uses the shared unfiltered status read', () => {
    const source = readTicketListSource();

    // The filter dropdown must keep offering statuses a ticket can legitimately
    // be parked in, so portal users can still find their own tickets.
    expect(source).toContain('getTicketStatuses()');
    expect(source).toContain('setRawStatusOptions');
  });

  it('T011: the per-board write picker uses the portal-filtered status read', () => {
    const source = readTicketListSource();

    // The inline per-row status control is a write affordance and must only
    // offer statuses an administrator marked portal-selectable.
    expect(source).toContain('getClientPortalTicketStatuses(boardId)');
    expect(source).toContain('setBoardStatusOptions');
  });
});
