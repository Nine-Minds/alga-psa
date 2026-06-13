import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const userProfilePath = path.join(process.cwd(), 'src/components/settings/profile/UserProfile.tsx');

describe('UserProfile calendar edition contract', () => {
  it('gates the Calendar tab through the shared calendar availability helper and the enterprise wrapper', () => {
    const source = fs.readFileSync(userProfilePath, 'utf8');

    expect(source).toContain(
      "import { isCalendarEnterpriseEdition, resolveUserProfileTab } from '@alga-psa/integrations/lib/calendarAvailability';"
    );
    expect(source).not.toContain("import { CalendarIntegrationsSettings } from '@alga-psa/integrations/components';");
    expect(source).toContain("const CalendarProfileSettings = dynamic(");
    expect(source).toContain("() => import('@alga-psa/ee-calendar/components').then((mod) => mod.CalendarProfileSettings)");
    // Calendar tab availability is derived from the shared edition helper (now
    // additionally gated off for AlgaDesk).
    expect(source).toContain('const isCalendarTabAvailable = isCalendarEnterpriseEdition()');
    expect(source).toContain('resolveUserProfileTab(tabParam, isCalendarTabAvailable)');
    expect(source).toContain('...(isCalendarTabAvailable ? [{');
    // The Calendar tab label is now internationalized.
    expect(source).toContain("label: t('profile.tabs.calendar', { defaultValue: 'Calendar' })");
    expect(source).toContain('content: <CalendarProfileSettings />');
  });
});
