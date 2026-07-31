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
    const emailProviderActionSource = fs.readFileSync(
      repoPath('packages/integrations/src/actions/email-actions/emailProviderActions.ts'),
      'utf8'
    );
    const emailCallbackSource = fs.readFileSync(
      repoPath('server/src/app/api/auth/microsoft/callback/route.ts'),
      'utf8'
    );
    const emailAdapterSource = fs.readFileSync(
      repoPath('shared/services/email/providers/MicrosoftGraphAdapter.ts'),
      'utf8'
    );
    const emailConfigBuilderSource = fs.readFileSync(
      repoPath('shared/services/email/microsoftEmailProviderConfig.ts'),
      'utf8'
    );
    // The concrete EE calendar action + adapter sources were relocated from
    // packages/ee/src/lib/... into the dedicated ee/packages/calendar package;
    // packages/ee/src now only re-exports stubs.
    const eeCalendarActionSource = fs.readFileSync(
      repoPath('ee/packages/calendar/src/lib/actions/integrations/calendarActions.ts'),
      'utf8'
    );
    const eeCalendarCallbackSource = fs.readFileSync(
      repoPath('ee/packages/calendar/src/app/api/auth/microsoft/calendar/callback/route.ts'),
      'utf8'
    );
    const eeCalendarAdapterSource = fs.readFileSync(
      repoPath('ee/packages/calendar/src/lib/services/calendar/providers/MicrosoftCalendarAdapter.ts'),
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
    // Reads flow through the tenantDb facade (tenantScopedTable wraps tenantDb(...).table(...)).
    expect(sharedResolverSource).toContain('return tenantDb(db, tenant).table(table);');
    expect(sharedResolverSource).toContain("tenantScopedTable(db, 'microsoft_profile_consumer_bindings', tenant)");
    expect(sharedResolverSource).toContain("tenantScopedTable(db, 'email_providers', tenant)");
    expect(sharedResolverSource).toContain("tenantScopedTable(db, 'calendar_providers', tenant)");
    expect(sharedResolverSource).toContain('profileHasCapability(profile, consumerType)');
    expect(sharedResolverSource).toContain('resolveMicrosoftBindingCandidateProfile(db, tenant, secretProvider, consumerType)');
    expect(sharedResolverSource).not.toContain("from '../actions/integrations/microsoftActions'");

    expect(emailOauthActionSource).toContain('resolveMicrosoftConsumerProfileConfig(tenant, \'email\')');
    expect(emailOauthActionSource).not.toContain("getTenantSecret(tenant, 'microsoft_client_id')");
    expect(emailOauthActionSource).not.toContain('process.env.MICROSOFT_CLIENT_ID');
    expect(emailProviderActionSource).toContain('preserveIssuingApp');
    expect(emailProviderActionSource).toContain('existingConfig?.refresh_token && !config.refresh_token');

    expect(emailCallbackSource).toContain("resolveMicrosoftConsumerProfileConfig(stateData.tenant, 'email')");
    expect(emailCallbackSource).toContain('persistProviderError');
    expect(emailCallbackSource).toContain("status: 'error'");
    expect(emailCallbackSource).toContain('error_message: message');
    expect(emailCallbackSource).toContain("error: 'token_persistence_failed'");
    expect(emailCallbackSource).not.toContain("getTenantSecret(stateData.tenant, 'microsoft_client_id')");
    expect(emailCallbackSource).not.toContain('process.env.MICROSOFT_CLIENT_ID');

    expect(emailConfigBuilderSource).toContain(".where('binding.consumer_type', 'email')");
    expect(emailConfigBuilderSource).toContain('profileCredentials.clientId === issuingClientId');
    expect(emailAdapterSource).toContain('vendorConfig.resolved_client_id');
    expect(fs.existsSync(repoPath('server/src/services/email/providers/MicrosoftGraphAdapter.ts'))).toBe(false);

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
