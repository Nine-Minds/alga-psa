import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketActionsSource(): string {
  return fs.readFileSync(path.resolve(process.cwd(), '../packages/tickets/src/actions/ticketActions.ts'), 'utf8');
}

describe('Algadesk ticket actions RBAC contracts', () => {
  it('keeps create/update permission checks and denied messages in ticket actions', () => {
    const source = readTicketActionsSource();

    expect(source).toContain("hasPermission(user, 'ticket', 'create'");
    expect(source).toContain('Permission denied: Cannot create ticket');
    expect(source).toContain("hasPermission(user, 'ticket', 'update'");
    expect(source).toContain('Permission denied: Cannot update ticket');
  });
});
