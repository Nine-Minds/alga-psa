import { describe, expect, it } from 'vitest';

import { navigationSections } from '../../config/menuConfig';

describe('navigationSections', () => {
  it('includes System Monitoring as an expandable menu with job and email log links', () => {
    const items = navigationSections.flatMap((section) => section.items);
    const systemMonitoringItem = items.find((item) => item.name === 'System Monitoring');

    expect(systemMonitoringItem).toBeTruthy();
    expect(systemMonitoringItem?.href).toBeUndefined();
    expect(systemMonitoringItem?.subItems).toBeTruthy();

    const subItems = systemMonitoringItem?.subItems ?? [];
    const jobMonitoringItem = subItems.find((item) => item.name === 'Job Monitoring');
    const emailLogsItem = subItems.find((item) => item.name === 'Email Logs');

    expect(jobMonitoringItem).toBeTruthy();
    expect(jobMonitoringItem?.href).toBe('/msp/jobs');
    expect(emailLogsItem).toBeTruthy();
    expect(emailLogsItem?.href).toBe('/msp/email-logs');
  });
});
