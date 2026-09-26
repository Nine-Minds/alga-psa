import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketDetailsSource(): string {
  return fs.readFileSync(path.resolve(__dirname, './TicketDetails.tsx'), 'utf8');
}

describe('MSP TicketDetails checklist reload contract', () => {
  it('reloads checklist items when any checklist auto-apply matcher changes', () => {
    const source = readTicketDetailsSource();
    const fetchAt = source.indexOf('getTicketChecklistItems(ticket.ticket_id)');
    expect(fetchAt).toBeGreaterThan(-1);

    // The dependency list of the effect that performs the fetch.
    const depsStart = source.indexOf('}, [', fetchAt);
    const depsEnd = source.indexOf(']);', depsStart);
    const deps = source.slice(depsStart, depsEnd);

    // Auto-apply rules match on board, category, subcategory and priority, so a
    // save that changes any of them can attach template items server-side.
    for (const field of ['ticket_id', 'status_id', 'board_id', 'category_id', 'subcategory_id', 'priority_id']) {
      expect(deps).toContain(`ticket.${field}`);
    }
  });
});
