import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const actionsDir = path.resolve(testDir, '../actions');

function read(relativePathFromComponents: string): string {
  return fs.readFileSync(path.resolve(testDir, relativePathFromComponents), 'utf8');
}

describe('Microsoft providers-first form contracts', () => {
  const emailFormSource = read('./email/MicrosoftProviderForm.tsx');
  const eeEmailFormSource = fs.readFileSync(
    path.resolve(testDir, '../../../../ee/server/src/components/MicrosoftProviderForm.tsx'),
    'utf8'
  );
  const calendarFormSource = fs.readFileSync(
    path.resolve(testDir, '../../../../ee/packages/calendar/src/components/calendar/MicrosoftCalendarProviderForm.tsx'),
    'utf8'
  );
  const emailActionsSource = fs.readFileSync(
    path.resolve(actionsDir, 'email-actions/emailProviderActions.ts'),
    'utf8'
  );
  const microsoftActionsSource = fs.readFileSync(
    path.resolve(actionsDir, 'integrations/microsoftActions.ts'),
    'utf8'
  );

  it('T018: Microsoft email form no longer requires manual OAuth credential fields', () => {
    expect(emailFormSource).not.toContain('clientId: z.string');
    expect(emailFormSource).not.toContain('clientSecret: z.string');
    expect(emailFormSource).toContain("client_id: ''");
    expect(emailFormSource).toContain("client_secret: ''");
  });
  it('T019: Microsoft email form keeps tenant-owned app setup behind an advanced CTA', () => {
    expect(emailFormSource).toContain('Use your own Microsoft app (advanced)');
    expect(emailFormSource).toContain('This is normally unnecessary on hosted Alga PSA.');
    expect(emailFormSource).toContain('configure-microsoft-providers-link');
    expect(emailFormSource).toContain('/msp/settings/integrations?category=providers');
  });

  it('keeps direct Enterprise imports aligned with shared mailbox readiness', () => {
    expect(eeEmailFormSource).toContain(
      "@alga-psa/integrations/components/email/MicrosoftProviderForm"
    );
    expect(emailFormSource).toContain("getMicrosoftConsumerSetupStatus('email')");
    expect(emailFormSource).toContain('providerSetupReady');
    expect(emailFormSource).toContain('Microsoft app profile is ready.');
    expect(emailFormSource).toContain('/msp/settings/integrations?category=providers');
  });

  it('records guided administrator consent before advancing the Email binding', () => {
    const confirmationStart = microsoftActionsSource.indexOf(
      'export async function confirmMicrosoftEmailAdminConsentInternal'
    );
    const confirmationEnd = microsoftActionsSource.indexOf(
      'export async function getMicrosoftEmailSetupMetadataInternal',
      confirmationStart
    );
    const confirmationSource = microsoftActionsSource.slice(confirmationStart, confirmationEnd);
    const consentWrite = confirmationSource.indexOf('email_admin_consent_granted_at: now');
    const bindingWrite = confirmationSource.indexOf("table('microsoft_profile_consumer_bindings')");

    expect(confirmationStart).toBeGreaterThanOrEqual(0);
    expect(consentWrite).toBeGreaterThanOrEqual(0);
    expect(bindingWrite).toBeGreaterThan(consentWrite);
    expect(microsoftActionsSource).toContain(
      'Microsoft tenant administrator consent must be recorded before binding this profile to Email'
    );
  });

  it('T020/T021: Microsoft calendar form uses providers-first CTA and saves without manual credentials', () => {
    expect(calendarFormSource).toContain('Microsoft provider settings are not configured.');
    expect(calendarFormSource).toContain('configure-microsoft-calendar-providers-link');
    expect(calendarFormSource).toContain('/msp/settings?category=providers');

    expect(calendarFormSource).toContain('createCalendarProvider({');
    expect(calendarFormSource).toContain("client_id: ''");
    expect(calendarFormSource).toContain("client_secret: ''");
    expect(calendarFormSource).toContain("tenant_id: ''");
  });

  it('T022: Microsoft email persistence derives credentials from tenant providers secrets instead of form fields', () => {
    expect(emailActionsSource).toContain("resolveMicrosoftConsumerProfileConfig(tenant, 'email', {");
    expect(emailActionsSource).toContain('credentialPreference');
    expect(emailActionsSource).toContain(
      "const effectiveClientId = microsoftProfile.clientId || '';"
    );
    expect(emailActionsSource).toContain(
      "const effectiveClientSecret = microsoftProfile.clientSecret || '';"
    );
    expect(emailActionsSource).toContain('microsoft_profile_id: pinnedProfileId');
    expect(emailActionsSource).toContain('client_secret_ref: pinnedClientSecretRef');
  });
});
