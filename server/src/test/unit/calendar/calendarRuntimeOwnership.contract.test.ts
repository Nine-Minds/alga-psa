import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('calendar runtime ownership contracts', () => {
  it('T383/T384: retargets calendar runtime entrypoints to the EE-owned service tree while Microsoft binding schema stays shared', () => {
    const serverRoot = process.cwd();
    const profilesMigrationSource = fs.readFileSync(
      path.join(serverRoot, 'migrations/20260307120000_create_microsoft_profiles.cjs'),
      'utf8'
    );
    const bindingsMigrationSource = fs.readFileSync(
      path.join(serverRoot, 'migrations/20260307143000_create_microsoft_profile_consumer_bindings.cjs'),
      'utf8'
    );

    const eeActionSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/lib/actions/integrations/calendarActions.ts'),
      'utf8'
    );
    const eeSubscriberSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/lib/eventBus/subscribers/calendarSyncSubscriber.ts'),
      'utf8'
    );
    const eeMaintenanceSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts'),
      'utf8'
    );
    const googleCallbackSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/app/api/auth/google/calendar/callback/route.ts'),
      'utf8'
    );
    const microsoftCallbackSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/app/api/auth/microsoft/calendar/callback/route.ts'),
      'utf8'
    );
    const googleWebhookSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/app/api/calendar/webhooks/google/route.ts'),
      'utf8'
    );
    const microsoftWebhookSource = fs.readFileSync(
      path.join(serverRoot, '../ee/packages/calendar/src/app/api/calendar/webhooks/microsoft/route.ts'),
      'utf8'
    );

    expect(profilesMigrationSource).toContain('microsoft_profile_consumer_bindings');
    expect(bindingsMigrationSource).toContain('explicit binding row');

    expect(eeActionSource).toContain('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService');
    expect(eeActionSource).toContain('@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService');
    expect(eeActionSource).toContain('@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookMaintenanceService');
    expect(eeActionSource).not.toContain("from '@/services/calendar/");

    expect(eeSubscriberSource).toContain('@alga-psa/ee-calendar/lib/services/calendar/CalendarSyncService');
    expect(eeSubscriberSource).toContain('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService');
    expect(eeSubscriberSource).not.toContain("from '@/services/calendar/");

    expect(eeMaintenanceSource).toContain('@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookMaintenanceService');
    expect(eeMaintenanceSource).toContain('@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter');
    expect(eeMaintenanceSource).toContain('@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService');
    expect(eeMaintenanceSource).not.toContain("from 'server/src/services/calendar/");

    expect(googleCallbackSource).toContain("@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService");
    expect(googleCallbackSource).toContain("@alga-psa/ee-calendar/lib/services/calendar/providers/GoogleCalendarAdapter");
    expect(googleCallbackSource).not.toContain("from '@/services/calendar/");

    expect(microsoftCallbackSource).toContain("@alga-psa/ee-calendar/lib/services/calendar/CalendarProviderService");
    expect(microsoftCallbackSource).toContain("@alga-psa/ee-calendar/lib/services/calendar/providers/MicrosoftCalendarAdapter");
    expect(microsoftCallbackSource).not.toContain("from '@/services/calendar/");

    expect(googleWebhookSource).toContain("@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookProcessor");
    expect(googleWebhookSource).not.toContain("from '@/services/calendar/");

    expect(microsoftWebhookSource).toContain("@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookProcessor");
    expect(microsoftWebhookSource).not.toContain("from '@/services/calendar/");
  });
});
