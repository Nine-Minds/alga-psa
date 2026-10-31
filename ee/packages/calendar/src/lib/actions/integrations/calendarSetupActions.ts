'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth } from '@alga-psa/auth/withAuth';
import {
  resolveMicrosoftConsumerProfileConfig,
  type MicrosoftConsumerProfileReasonCode,
} from '../../microsoftConsumerProfileResolution';
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

export const getMicrosoftCalendarSetupStatus = withAuth(async (
  user,
  { tenant }
): Promise<{
  success: boolean;
  error?: string;
  ready?: boolean;
  /** `pending_admin_consent`: profile is bound but a Microsoft 365 admin still has to approve it. */
  state?: 'ready' | 'pending_admin_consent' | 'not_configured';
  /** Redirect URI the authorize request will send; register it in the Entra app. */
  redirectUri?: string;
  profileId?: string | null;
  message?: string;
  reasonCode?: MicrosoftConsumerProfileReasonCode;
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

    const profile = await resolveMicrosoftConsumerProfileConfig(tenant, 'calendar');
    if (profile.status !== 'ready') {
      return {
        success: true,
        ready: false,
        state: 'not_configured',
        redirectUri,
        profileId: profile.profileId || null,
        message: profile.message || 'No Microsoft profile is currently bound to Calendar.',
        reasonCode: profile.reasonCode,
      };
    }

    if (profile.adminConsentPending) {
      return {
        success: true,
        ready: false,
        state: 'pending_admin_consent',
        redirectUri,
        profileId: profile.profileId,
        message: 'Microsoft 365 administrator approval is still required',
      };
    }

    return {
      success: true,
      ready: true,
      state: 'ready',
      redirectUri,
      profileId: profile.profileId,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to load Microsoft calendar setup status',
    };
  }
});
