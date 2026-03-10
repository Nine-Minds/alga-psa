import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function repoPath(relativePath: string): string {
  return path.join(process.cwd(), '..', relativePath);
}

describe('calendar actions EE ownership', () => {
  it('T361/T362: shared calendar actions stay as EE-gated wrappers while fresh EE installs resolve concrete provider and sync logic through enterprise codepaths', () => {
    const sharedSource = fs.readFileSync(
      repoPath('packages/integrations/src/actions/calendarActions.ts'),
      'utf8'
    );
    const eeSource = fs.readFileSync(
      repoPath('ee/packages/calendar/src/lib/actions/integrations/calendarActions.ts'),
      'utf8'
    );
    const eeForwarderSource = fs.readFileSync(
      repoPath('packages/ee/src/lib/actions/integrations/calendarActions.ts'),
      'utf8'
    );

    expect(sharedSource).toContain("import('@alga-psa/ee-calendar/actions')");
    expect(sharedSource).toContain('isCalendarEnterpriseEdition');
    expect(sharedSource).not.toContain('CalendarProviderService');
    expect(sharedSource).not.toContain('CalendarSyncService');
    expect(sharedSource).not.toContain('CalendarWebhookMaintenanceService');
    expect(sharedSource).not.toContain('GoogleCalendarAdapter');
    expect(sharedSource).not.toContain('MicrosoftCalendarAdapter');

    expect(eeSource).toContain('CalendarProviderService');
    expect(eeSource).toContain('CalendarSyncService');
    expect(eeSource).toContain('CalendarWebhookMaintenanceService');
    expect(eeSource).toContain('GoogleCalendarAdapter');
    expect(eeSource).toContain('MicrosoftCalendarAdapter');
    expect(eeForwarderSource).toContain("@alga-psa/ee-calendar/actions");
  });
});
