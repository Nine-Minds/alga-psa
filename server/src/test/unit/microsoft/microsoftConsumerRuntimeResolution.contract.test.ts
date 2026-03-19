import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function repoPath(relativePath: string): string {
  return path.join(process.cwd(), '..', relativePath);
}

describe('microsoft consumer runtime resolution contracts', () => {
  it('T323/T324/T325/T326: routes live email and calendar Microsoft consumers through the shared binding-aware resolver instead of tenant/env fallbacks', () => {
    const sharedResolverSource = fs.readFileSync(
      repoPath('packages/integrations/src/lib/microsoftConsumerProfileResolution.ts'),
      'utf8'
    );
    const emailOauthActionSource = fs.readFileSync(
      repoPath('packages/integrations/src/actions/email-actions/oauthActions.ts'),
      'utf8'
    );
    const emailCallbackSource = fs.readFileSync(
      repoPath('server/src/app/api/auth/microsoft/callback/route.ts'),
      'utf8'
    );
    const emailAdapterSource = fs.readFileSync(
      repoPath('server/src/services/email/providers/MicrosoftGraphAdapter.ts'),
      'utf8'
    );
    const eeCalendarActionSource = fs.readFileSync(
      repoPath('packages/ee/src/lib/actions/integrations/calendarActions.ts'),
      'utf8'
    );
    const eeCalendarCallbackSource = fs.readFileSync(
      repoPath('ee/server/src/app/api/auth/microsoft/calendar/callback/route.ts'),
      'utf8'
    );
    const eeCalendarAdapterSource = fs.readFileSync(
      repoPath('packages/ee/src/lib/services/calendar/providers/MicrosoftCalendarAdapter.ts'),
      'utf8'
    );
    const mspSsoResolutionSource = fs.readFileSync(
      repoPath('packages/auth/src/lib/sso/mspSsoResolution.ts'),
      'utf8'
    );
    const nextAuthOptionsSource = fs.readFileSync(
      repoPath('packages/auth/src/lib/nextAuthOptions.ts'),
      'utf8'
    );

    expect(sharedResolverSource).toContain("from '../actions/integrations/microsoftShared'");
    expect(sharedResolverSource).toContain('ensureMicrosoftConsumerBindingMigration');
    expect(sharedResolverSource).toContain("db('microsoft_profile_consumer_bindings')");
    expect(sharedResolverSource).toContain("db('email_providers')");
    expect(sharedResolverSource).toContain("db('calendar_providers')");
    expect(sharedResolverSource).not.toContain("from '../actions/integrations/microsoftActions'");

    expect(emailOauthActionSource).toContain('resolveMicrosoftConsumerProfileConfig(tenant, \'email\')');
    expect(emailOauthActionSource).not.toContain("getTenantSecret(tenant, 'microsoft_client_id')");
    expect(emailOauthActionSource).not.toContain('process.env.MICROSOFT_CLIENT_ID');

    expect(emailCallbackSource).toContain("resolveMicrosoftConsumerProfileConfig(stateData.tenant, 'email')");
    expect(emailCallbackSource).not.toContain("getTenantSecret(stateData.tenant, 'microsoft_client_id')");
    expect(emailCallbackSource).not.toContain('process.env.MICROSOFT_CLIENT_ID');

    expect(emailAdapterSource).toContain("resolveMicrosoftConsumerProfileConfig(this.config.tenant, 'email')");
    expect(emailAdapterSource).not.toContain('process.env.MICROSOFT_CLIENT_ID');

    expect(eeCalendarActionSource).toContain("resolveMicrosoftConsumerProfileConfig(tenant, 'calendar')");
    expect(eeCalendarActionSource).not.toContain("getTenantSecret(tenant, 'microsoft_client_id')");
    expect(eeCalendarActionSource).not.toContain('process.env.MICROSOFT_CLIENT_ID');

    expect(eeCalendarCallbackSource).toContain("resolveMicrosoftConsumerProfileConfig(stateData.tenant, 'calendar')");
    expect(eeCalendarCallbackSource).not.toContain("getTenantSecret(stateData.tenant, 'microsoft_client_id')");
    expect(eeCalendarCallbackSource).not.toContain('process.env.MICROSOFT_CLIENT_ID');

    expect(eeCalendarAdapterSource).toContain("resolveMicrosoftConsumerProfileConfig(this.config.tenant, 'calendar')");
    expect(eeCalendarAdapterSource).not.toContain('process.env.MICROSOFT_CLIENT_ID');

    expect(mspSsoResolutionSource).toContain("resolveMicrosoftConsumerProfileConfig(tenant, 'msp_sso')");
    expect(mspSsoResolutionSource).not.toContain("getTenantSecret(tenant, 'microsoft_client_id')");

    expect(nextAuthOptionsSource).toContain("resolveMicrosoftConsumerProfileConfig(");
    expect(nextAuthOptionsSource).toContain("'msp_sso'");
    expect(nextAuthOptionsSource).not.toContain("getTenantSecret(resolution.tenantId, 'microsoft_client_id')");
  });
});
