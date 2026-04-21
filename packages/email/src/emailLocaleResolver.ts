/**
 * Email Locale Resolver
 *
 * Resolves the appropriate locale for email notifications sent to users.
 *
 * Hierarchy:
 * 1. User preference (user_preferences table) — only if userId is provided
 * 2. Client-specific default (clients.properties.defaultLocale) — client-portal users / portal invitations
 * 3. Client-portal default (settings.clientPortal.defaultLocale) — client-portal users only
 * 4. Organization default (settings.defaultLocale) — applies to everyone
 * 5. System default ('en')
 *
 * Internal (MSP staff) users skip steps 2 and 3 and resolve directly to the
 * organization default. Legacy settings.mspPortal.defaultLocale (from the
 * retired split UI) is consulted only if the org default is unset.
 *
 * Feature-flag gate: when msp-i18n-enabled is off, internal users are forced
 * to English regardless of the hierarchy. This matches the UI rollout so MSP
 * staff don't start receiving non-English emails before the flag is flipped.
 *
 * Special handling for portal invitations: when sending invitations to
 * contacts without user accounts yet, provide the clientId so the client's
 * defaultLocale is respected.
 */

import { getConnection } from '@alga-psa/db';
import { SupportedLocale, isSupportedLocale, LOCALE_CONFIG } from './lib/localeConfig';
import logger from '@alga-psa/core/logger';
import { featureFlags } from '@alga-psa/core/server';

export interface EmailRecipient {
  email: string;
  userId?: string;
  userType?: 'client' | 'internal';
  clientId?: string;
}

/**
 * Returns true when MSP i18n is enabled for this tenant/user. When disabled,
 * internal (MSP) users must receive English emails regardless of preferences,
 * matching the UI rollout gated by I18nWrapper.
 */
async function isMspI18nEnabled(
  tenantId: string,
  userId?: string
): Promise<boolean> {
  try {
    return await featureFlags.isEnabled('msp-i18n-enabled', {
      tenantId,
      userId,
    });
  } catch (error) {
    logger.warn('[EmailLocaleResolver] msp-i18n-enabled evaluation failed; defaulting to disabled', {
      error: error instanceof Error ? error.message : String(error),
      tenantId,
      userId,
    });
    return false;
  }
}

/**
 * Get the user's client ID from their contact
 */
async function getUserClientId(userId: string, tenantId: string): Promise<string | null> {
  try {
    const knex = await getConnection(tenantId);

    // Get user's contact_id
    const user = await knex('users')
      .where({
        user_id: userId,
        tenant: tenantId
      })
      .first();

    if (!user?.contact_id) return null;

    // Get contact's client
    const contact = await knex('contacts')
      .where({
        contact_name_id: user.contact_id,
        tenant: tenantId
      })
      .first();

    return contact?.client_id || null;
  } catch (error) {
    logger.error('[EmailLocaleResolver] Error getting user client ID:', { error, userId, tenantId });
    return null;
  }
}

/**
 * Resolve the locale for an email recipient based on user preferences and hierarchy
 */
export async function resolveEmailLocale(
  tenantId: string,
  recipient: EmailRecipient
): Promise<SupportedLocale> {
  const knex = await getConnection(tenantId);

  try {
    // Get user information if not provided
    let userType = recipient.userType;
    let clientId = recipient.clientId;

    // Resolve userType early so we can feature-flag gate internal users
    if (recipient.userId && !userType) {
      const user = await knex('users')
        .where({
          user_id: recipient.userId,
          tenant: tenantId
        })
        .first();

      userType = user?.user_type || 'internal';
    }

    // Internal (MSP) users: force English while msp-i18n-enabled is off
    if (userType === 'internal') {
      const enabled = await isMspI18nEnabled(tenantId, recipient.userId);
      if (!enabled) {
        logger.debug('[EmailLocaleResolver] msp-i18n-enabled is off; forcing English for internal user', {
          tenantId,
          userId: recipient.userId
        });
        return LOCALE_CONFIG.defaultLocale as SupportedLocale;
      }
    }

    // If we have a userId, check user preference and get user details
    if (recipient.userId) {
      // 1. Check user preference
      const userPref = await knex('user_preferences')
        .where({
          user_id: recipient.userId,
          setting_name: 'locale',
          tenant: tenantId
        })
        .first();

      if (userPref?.setting_value) {
        const locale = typeof userPref.setting_value === 'string'
          ? userPref.setting_value.replace(/"/g, '')
          : userPref.setting_value;

        if (isSupportedLocale(locale)) {
          logger.debug('[EmailLocaleResolver] Using user preference:', { locale, userId: recipient.userId });
          return locale;
        }
      }

      // Try to get clientId from user if not provided
      if (!clientId && userType === 'client') {
        const resolvedClientId = await getUserClientId(recipient.userId, tenantId);
        clientId = resolvedClientId ?? undefined;
      }
    }

    // 2. Client-specific default (client-portal users / portal invitations)
    if ((userType === 'client' || clientId) && clientId) {
      const client = await knex('clients')
        .where({ client_id: clientId, tenant: tenantId })
        .first();

      const clientLocale = client?.properties?.defaultLocale;
      if (clientLocale && isSupportedLocale(clientLocale)) {
        logger.debug('[EmailLocaleResolver] Using client preference:', { locale: clientLocale, clientId });
        return clientLocale;
      }
    }

    // 3. Client-portal default (client-portal users only)
    if (userType === 'client' || clientId) {
      const tenantSettings = await knex('tenant_settings')
        .where({ tenant: tenantId })
        .first();

      const clientPortalLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
      if (clientPortalLocale && isSupportedLocale(clientPortalLocale)) {
        logger.debug('[EmailLocaleResolver] Using client-portal default:', { locale: clientPortalLocale });
        return clientPortalLocale;
      }
    }

    // 4. Organization default (applies to everyone; legacy MSP fallback inside)
    const defaultLocale = await getTenantDefaultLocale(tenantId, userType || 'client');
    logger.debug('[EmailLocaleResolver] Using org/system default:', { locale: defaultLocale, userType: userType || 'client' });
    return defaultLocale;

  } catch (error) {
    logger.error('[EmailLocaleResolver] Error resolving email locale:', { error, tenantId, recipient });
    // Fall back to system default on error
    return LOCALE_CONFIG.defaultLocale as SupportedLocale;
  }
}

/**
 * Get the org-wide default locale with legacy MSP fallback for internal users.
 * (Client-portal default is handled explicitly at resolveEmailLocale step 3.)
 */
export async function getTenantDefaultLocale(
  tenantId: string,
  userType?: 'client' | 'internal'
): Promise<SupportedLocale> {
  try {
    const knex = await getConnection(tenantId);
    const tenantSettings = await knex('tenant_settings')
      .where({ tenant: tenantId })
      .first();

    const tenantDefaultLocale = tenantSettings?.settings?.defaultLocale;
    if (tenantDefaultLocale && isSupportedLocale(tenantDefaultLocale)) {
      return tenantDefaultLocale;
    }

    // Legacy MSP-only default (retired split UI)
    if (userType === 'internal') {
      const legacyMspLocale = tenantSettings?.settings?.mspPortal?.defaultLocale;
      if (legacyMspLocale && isSupportedLocale(legacyMspLocale)) {
        return legacyMspLocale;
      }
    }
  } catch (error) {
    logger.error('[EmailLocaleResolver] Error getting tenant default locale:', { error, tenantId });
  }

  return LOCALE_CONFIG.defaultLocale as SupportedLocale;
}

/**
 * Resolve locale for multiple recipients
 * Returns a map of email -> locale
 */
export async function resolveEmailLocalesForRecipients(
  tenantId: string,
  recipients: EmailRecipient[]
): Promise<Map<string, SupportedLocale>> {
  const localeMap = new Map<string, SupportedLocale>();

  for (const recipient of recipients) {
    const locale = await resolveEmailLocale(tenantId, recipient);
    localeMap.set(recipient.email, locale);
  }

  return localeMap;
}

/**
 * Get user information for locale resolution
 * Helper to fetch user data when only email is known
 */
export async function getUserInfoForEmail(
  tenantId: string,
  email: string
): Promise<EmailRecipient | null> {
  try {
    const knex = await getConnection(tenantId);

    const user = await knex('users')
      .where({
        email,
        tenant: tenantId
      })
      .first();

    if (!user) {
      return { email };
    }

    let clientId: string | null = null;
    if (user.user_type === 'client' && user.contact_id) {
      clientId = await getUserClientId(user.user_id, tenantId);
    }

    return {
      email,
      userId: user.user_id,
      userType: user.user_type || 'internal',
      clientId: clientId || undefined
    };
  } catch (error) {
    logger.error('[EmailLocaleResolver] Error getting user info for email:', { error, email, tenantId });
    return { email };
  }
}
