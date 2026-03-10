import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function repoPath(relativePath: string): string {
  return path.join(process.cwd(), '..', relativePath);
}

describe('calendar actions EE ownership', () => {
  it('keeps shared calendar actions as availability-gated wrappers while EE owns the concrete provider and sync logic', () => {
    const sharedSource = fs.readFileSync(
      repoPath('packages/integrations/src/actions/calendarActions.ts'),
      'utf8'
    );
    const eeSource = fs.readFileSync(
      repoPath('packages/ee/src/lib/actions/integrations/calendarActions.ts'),
      'utf8'
    );

    expect(sharedSource).toContain("import('@enterprise/lib/actions/integrations/calendarActions')");
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
  });
});
