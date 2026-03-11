import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('calendarWebhookMaintenanceHandler delegator', () => {
  const originalEdition = process.env.EDITION;
  const originalPublicEdition = process.env.NEXT_PUBLIC_EDITION;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.EDITION;
    delete process.env.NEXT_PUBLIC_EDITION;
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (originalEdition === undefined) {
      delete process.env.EDITION;
    } else {
      process.env.EDITION = originalEdition;
    }

    if (originalPublicEdition === undefined) {
      delete process.env.NEXT_PUBLIC_EDITION;
    } else {
      process.env.NEXT_PUBLIC_EDITION = originalPublicEdition;
    }
  });

  it('no-ops in CE without loading the EE maintenance module', async () => {
    process.env.EDITION = 'ce';

    const eeRenew = vi.fn();
    const eeVerify = vi.fn();

    vi.doMock('@alga-psa/ee-calendar/jobs', () => ({
      renewMicrosoftCalendarWebhooks: eeRenew,
      verifyGoogleCalendarProvisioning: eeVerify,
    }));

    const handlerModule = await import('@/lib/jobs/handlers/calendarWebhookMaintenanceHandler');

    await handlerModule.renewMicrosoftCalendarWebhooks({ tenantId: 'tenant-ce' });
    await handlerModule.verifyGoogleCalendarProvisioning({ tenantId: 'tenant-ce' });

    expect(eeRenew).not.toHaveBeenCalled();
    expect(eeVerify).not.toHaveBeenCalled();
  });

  it('delegates to the EE maintenance module in enterprise mode', async () => {
    process.env.EDITION = 'ee';
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';

    const eeRenew = vi.fn(async () => undefined);
    const eeVerify = vi.fn(async () => undefined);

    vi.doMock('@alga-psa/ee-calendar/jobs', () => ({
      renewMicrosoftCalendarWebhooks: eeRenew,
      verifyGoogleCalendarProvisioning: eeVerify,
    }));

    const handlerModule = await import('@/lib/jobs/handlers/calendarWebhookMaintenanceHandler');

    const renewalInput = { tenantId: 'tenant-ee', lookAheadMinutes: 90 };
    const verifyInput = { tenantId: 'tenant-ee' };

    await handlerModule.renewMicrosoftCalendarWebhooks(renewalInput);
    await handlerModule.verifyGoogleCalendarProvisioning(verifyInput);

    expect(eeRenew).toHaveBeenCalledWith(renewalInput);
    expect(eeVerify).toHaveBeenCalledWith(verifyInput);
  });

  it('keeps live maintenance imports out of the shared handler wrapper', () => {
    const serverRoot = process.cwd();
    const sharedSource = fs.readFileSync(
      path.join(serverRoot, 'src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts'),
      'utf8'
    );
    const eeSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts'),
      'utf8'
    );

    expect(sharedSource).toContain("@alga-psa/ee-calendar/jobs");
    expect(sharedSource).not.toContain('CalendarWebhookMaintenanceService');
    expect(sharedSource).not.toContain('GoogleCalendarAdapter');
    expect(sharedSource).not.toContain('CalendarProviderService');

    expect(eeSource).toContain('CalendarWebhookMaintenanceService');
    expect(eeSource).toContain('GoogleCalendarAdapter');
    expect(eeSource).toContain('CalendarProviderService');
  });
});
