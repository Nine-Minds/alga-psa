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
  const calendarFormSource = fs.readFileSync(
    path.resolve(testDir, '../../../../ee/packages/calendar/src/components/calendar/MicrosoftCalendarProviderForm.tsx'),
    'utf8'
  );
  const emailActionsSource = fs.readFileSync(
    path.resolve(actionsDir, 'email-actions/emailProviderActions.ts'),
    'utf8'
  );

  it('T018: Microsoft email form no longer requires manual OAuth credential fields', () => {
    expect(emailFormSource).not.toContain('clientId: z.string');
    expect(emailFormSource).not.toContain('clientSecret: z.string');
    expect(emailFormSource).toContain("client_id: ''");
    expect(emailFormSource).toContain("client_secret: ''");
  });

  it('T019: Microsoft email form shows Providers-first CTA when provider setup is missing', () => {
    expect(emailFormSource).toContain('Microsoft provider settings are not configured.');
    expect(emailFormSource).toContain('configure-microsoft-providers-link');
    expect(emailFormSource).toContain('/msp/settings?category=providers');
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
    expect(emailActionsSource).toContain("getTenantSecret(tenant, 'microsoft_client_id')");
    expect(emailActionsSource).toContain("getTenantSecret(tenant, 'microsoft_client_secret')");
    expect(emailActionsSource).toContain(
      "const effectiveClientId = hostedConfig?.client_id || tenantClientId || config.client_id || '';"
    );
    expect(emailActionsSource).toContain(
      "const effectiveClientSecret = hostedConfig?.client_secret || tenantClientSecret || config.client_secret || '';"
    );
  });
});
