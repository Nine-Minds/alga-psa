import { describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';

describe('TicketDetails', () => {
  it('opens email notifications from a drawer trigger instead of rendering the inline section', async () => {
    const filePath = path.resolve(process.cwd(), '../packages/tickets/src/components/ticket/TicketDetails.tsx');
    const contents = await fs.readFile(filePath, 'utf8');

    expect(contents).toContain('TicketEmailNotifications');
    expect(contents).toContain('onOpenEmailNotificationLogs={() => setIsEmailNotificationLogsDrawerOpen(true)}');
    expect(contents).toContain('<Drawer');
    expect(contents).toContain('variant="flat"');
  });
});
