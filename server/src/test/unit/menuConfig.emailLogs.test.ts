import { describe, expect, it } from 'vitest';

import { navigationSections } from '../../config/menuConfig';

describe('navigationSections', () => {
  it('includes Job Monitoring as a direct link without submenu', () => {
    const items = navigationSections.flatMap((section) => section.items);
    const jobMonitoringItem = items.find((item) => item.name === 'Job Monitoring');

    expect(jobMonitoringItem).toBeTruthy();
    expect(jobMonitoringItem?.href).toBe('/msp/jobs');
    expect(jobMonitoringItem?.subItems).toBeUndefined();
  });
});
