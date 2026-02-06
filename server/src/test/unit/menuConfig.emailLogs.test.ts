import { describe, expect, it } from 'vitest';

import { navigationSections } from '../../config/menuConfig';

describe('navigationSections', () => {
  it('includes Email Logs link under System Monitor', () => {
    const items = navigationSections.flatMap((section) => section.items);
    const systemMonitorItem = items.find((item) => item.name === 'System Monitor');

    expect(systemMonitorItem).toBeTruthy();
    expect(systemMonitorItem?.subItems?.length).toBeTruthy();

    const emailLogsItem = systemMonitorItem?.subItems?.find((item) => item.name === 'Email Logs');
    expect(emailLogsItem).toBeTruthy();
    expect(emailLogsItem?.href).toBe('/msp/email-logs');
  });
});

