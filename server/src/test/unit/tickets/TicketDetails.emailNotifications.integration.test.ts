import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';

describe('TicketDetails', () => {
  it('includes the TicketEmailNotifications section', async () => {
    const filePath = path.resolve(process.cwd(), '../packages/tickets/src/components/ticket/TicketDetails.tsx');
    const contents = await fs.readFile(filePath, 'utf8');

    expect(contents).toContain('TicketEmailNotifications');
    expect(contents).toContain('<TicketEmailNotifications');
  });
});
