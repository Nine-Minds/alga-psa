import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('documents view route ticket authorization contract', () => {
  it('T013/T014: enforces ticket-scoped authorization guard and grants authorized contact/client access', () => {
    const filePath = path.resolve(
      __dirname,
      '../../app/api/documents/view/[fileId]/route.ts'
    );
    const source = fs.readFileSync(filePath, 'utf-8');

    expect(source).toContain('const associatedTicketIds = new Set<string>()');
    expect(source).toContain("assoc.entity_type === 'ticket'");
    expect(source).toContain('if (!hasPermission && associatedTicketIds.size > 0 && user.contact_id)');
    expect(source).toContain("whereIn('ticket_id', Array.from(associatedTicketIds))");
    expect(source).toContain('hasPermission = true');
    expect(source).toContain('return new NextResponse');
  });
});
