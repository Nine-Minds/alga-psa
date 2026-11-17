'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  resolveMicrosoftConsumerProfileConfig,
  type MicrosoftConsumerProfileReasonCode,
} from '../../microsoftConsumerProfileResolution';
import {
  isMicrosoftPlatformAppOffered,
  isMicrosoftPlatformClientId,
  reconcileMicrosoftPlatformAppProfile,
} from '@alga-psa/integrations/lib/microsoftPlatformApp';
import { getMicrosoftPlatformClientId } from '@alga-psa/integrations/lib/microsoftConsumerProfileResolution';
import { resolveCalendarRedirectUri } from '../../utils/calendar/redirectUri';

const GOOGLE_CLIENT_ID_SECRET = 'google_client_id';
const GOOGLE_CLIENT_SECRET_SECRET = 'google_client_secret';
const GOOGLE_CALENDAR_CLIENT_ID_SECRET = 'google_calendar_client_id';
const GOOGLE_CALENDAR_CLIENT_SECRET_SECRET = 'google_calendar_client_secret';

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 4) return '•'.repeat(value.length);
  return `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
}

export const getGoogleCalendarSetupStatus = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  config?: {
    calendarClientId?: string;
    calendarClientSecretMasked?: string;
  };
}> => {
  try {
    if ((user as any)?.user_type === 'client') {
      return { success: false, error: 'Forbidden' };
    }

    const secretProvider = await getSecretProviderInstance();
    const [gmailClientId, gmailClientSecret, calendarClientId, calendarClientSecret] =
      await Promise.all([
        secretProvider.getTenantSecret(tenant, GOOGLE_CLIENT_ID_SECRET),
        secretProvider.getTenantSecret(tenant, GOOGLE_CLIENT_SECRET_SECRET),
        secretProvider.getTenantSecret(tenant, GOOGLE_CALENDAR_CLIENT_ID_SECRET),
        secretProvider.getTenantSecret(tenant, GOOGLE_CALENDAR_CLIENT_SECRET_SECRET),
      ]);

    const resolvedCalendarClientId = calendarClientId || gmailClientId || undefined;
    const resolvedCalendarClientSecret = calendarClientSecret || gmailClientSecret || undefined;

    return {
      success: true,
      config: {
        calendarClientId: resolvedCalendarClientId,
        calendarClientSecretMasked: resolvedCalendarClientSecret
          ? maskSecret(resolvedCalendarClientSecret)
          : undefined,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load Google calendar setup status' };
  }
});

export type MicrosoftCalendarCredentialSource = 'platform' | 'tenant_app';

export const getMicrosoftCalendarSetupStatus = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  ready?: boolean;
  state?: 'ready' | 'not_configured';
  /** Redirect URI the authorize request will send; register it in the Entra app. */
  redirectUri?: string;
  profileId?: string | null;
  message?: string;
  reasonCode?: MicrosoftConsumerProfileReasonCode;
  /** Whose app the bound profile is: the AlgaPSA-supplied app or a tenant-owned one. Set only when ready. */
  source?: MicrosoftCalendarCredentialSource;
  /** Whether the AlgaPSA-supplied Microsoft app is offered on this deployment. */
  platformOffered?: boolean;
  /**
   * Whether this user may manage Microsoft provider settings (the same check
   * those settings use: system_settings:update). Gates the admin consent link.
   */
  canManageProviderSettings?: boolean;
}> => {
  try {
    if ((user as any)?.user_type === 'client') {
      return { success: false, error: 'Forbidden' };
    }

    const secretProvider = await getSecretProviderInstance();
    // Same resolver the authorize step uses, so the URI shown is the URI sent.
    const redirectUri = await resolveCalendarRedirectUri({
      tenant,
      provider: 'microsoft',
      secretProvider,
      hosted: false,
    });

    // Bring a consented supplied-app profile up to what the platform app serves
    // (adds Calendar capability/binding when absent, never overrides a binding).
    // Must not break the readiness read if it fails.
    try {
      await reconcileMicrosoftPlatformAppProfile(tenant);
    } catch (reconcileError: any) {
      console.warn('[calendarSetupActions] supplied-app reconcile failed', {
        tenant,
        error: reconcileError?.message || 'unknown',
      });
    }

    const [profile, platformOffered, platformClientId, canManageProviderSettings] = await Promise.all([
      resolveMicrosoftConsumerProfileConfig(tenant, 'calendar'),
      isMicrosoftPlatformAppOffered(),
      getMicrosoftPlatformClientId(),
      hasPermission(user as any, 'system_settings', 'update'),
    ]);
    if (profile.status !== 'ready') {
      return {
        success: true,
        ready: false,
        state: 'not_configured',
        redirectUri,
        profileId: profile.profileId || null,
        message: profile.message || 'No Microsoft profile is currently bound to Calendar.',
        reasonCode: profile.reasonCode,
        platformOffered,
        canManageProviderSettings,
      };
    }

    return {
      success: true,
      ready: true,
      state: 'ready',
      redirectUri,
      profileId: profile.profileId,
      // Same derivation as getMicrosoftEmailSetupReadiness: client id equals the platform app's.
      source: isMicrosoftPlatformClientId(profile.clientId, platformClientId) ? 'platform' : 'tenant_app',
      platformOffered,
      canManageProviderSettings,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to load Microsoft calendar setup status',
    };
  }
});
