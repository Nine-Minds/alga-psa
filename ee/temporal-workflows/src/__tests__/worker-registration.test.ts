import { describe, expect, it } from 'vitest';
import * as workflows from '../workflows/index.js';
import * as activities from '../activities/index.js';

describe('temporal worker registration', () => {
  it('exports slaTicketWorkflow from workflow index', () => {
    expect(workflows.slaTicketWorkflow).toBeDefined();
  });

  it('exports SLA activities from activities index', () => {
    expect(activities.calculateNextWakeTime).toBeDefined();
    expect(activities.sendSlaNotification).toBeDefined();
    expect(activities.checkAndEscalate).toBeDefined();
    expect(activities.updateSlaStatus).toBeDefined();
  });
});
