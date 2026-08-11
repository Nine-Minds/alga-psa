import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const actionsDir = path.resolve(testDir, '../actions');

function read(relativePathFromComponents: string): string {
  return fs.readFileSync(path.resolve(testDir, relativePathFromComponents), 'utf8');
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
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
  it('T019: Microsoft email form delegates app setup to Providers', () => {
    expect(emailFormSource).not.toContain('Use your own Microsoft app');
    expect(emailFormSource).not.toContain('Redirect URI');
    expect(emailFormSource).toContain('Set it up in Providers');
    expect(emailFormSource).toContain('Open Providers');
    expect(emailFormSource).toContain('/msp/settings/integrations?category=providers');
  });

  it('keeps direct Enterprise imports aligned with shared mailbox readiness', () => {
    expect(eeEmailFormSource).toContain(
      "@alga-psa/integrations/components/email/MicrosoftProviderForm"
    );
    expect(emailFormSource).toContain('emailSetup?: MicrosoftEmailSetupReadiness | null');
    // Progressive disclosure: the issuer picker is the only readiness surface.
    // Sign-in is gated on the selected issuer, never on a global setup banner,
    // and pending admin consent surfaces only as own-app path status.
    expect(emailFormSource).toContain('ownAppPendingConsent');
    expect(emailFormSource).not.toContain('providerSetupReady');
    expect(emailFormSource).not.toContain('Microsoft is set up. Sign in as this mailbox to finish.');
    expect(emailFormSource).toContain("disabled={issuerOptionsLoading || !selectedIssuer || oauthStatus === 'authorizing'}");
    expect(emailFormSource).toContain('Sign in with Microsoft');
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

  it('T022: Microsoft email persistence requires an explicit issuer and never falls back to the Email binding on create/save', () => {
    expect(emailActionsSource).toContain('resolveMicrosoftEmailIssuerChoice(tenant, issuer)');
    expect(emailActionsSource).toContain('preserveIssuingApp');
    expect(emailActionsSource).toContain('CLIENT_MISMATCH_RECONNECT_REQUIRED');
    expect(emailActionsSource).toContain('ISSUER_REQUIRED');
    expect(emailActionsSource).toContain('explicit selection fails loudly');
    // The silent tenant-binding fallback on new writes is gone; the binding may
    // only inform the UI default and the legacy runtime backfill.
    expect(emailActionsSource).not.toContain("resolveMicrosoftConsumerProfileConfig(tenant, 'email', {");
    expect(emailActionsSource).not.toContain("credentialPreference: 'tenant'");
    expect(emailActionsSource).not.toContain('microsoftCredentialSource');
    expect(emailActionsSource).toContain('getMicrosoftEmailSetupMetadataInternal()).mailboxRedirectUri');
    expect(emailActionsSource).toContain(
      'let effectiveClientId = resolution.clientId;'
    );
    expect(emailActionsSource).toContain('microsoft_profile_id: pinnedProfileId');
    expect(emailActionsSource).toContain('client_secret_ref: pinnedClientSecretRef');
  });

  it('keeps bare tenant terminology out of Microsoft email setup copy', () => {
    const emailProviderLocale = JSON.parse(read('../../../../server/public/locales/en/msp/email-providers.json'));
    const integrationsLocale = JSON.parse(read('../../../../server/public/locales/en/msp/integrations.json'));
    const microsoftCopy = [
      ...collectStrings(emailProviderLocale.configuration.setup.microsoft),
      ...collectStrings(emailProviderLocale.forms.microsoft),
      ...collectStrings(integrationsLocale.integrations.microsoft.emailSetup),
      ...collectStrings(integrationsLocale.integrations.microsoft.settings),
    ];

    expect(microsoftCopy.filter((copy) => /(?<!Microsoft )\btenant\b/i.test(copy))).toEqual([]);
  });
});
