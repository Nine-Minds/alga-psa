/**
 * Email Locale Resolver
 *
 * Resolves the appropriate locale for email notifications sent to users.
 * This implements the same hierarchy as the client portal i18n system,
 * ensuring emails are sent in the user's preferred language.
 *
 * Hierarchy (for client portal users):
 * 1. User preference (user_preferences table) - only if userId is provided
 * 2. Client preference (clients.properties.defaultLocale) - checked if clientId is provided
 * 3. Tenant client portal default (tenant_settings.settings.clientPortal.defaultLocale)
 * 4. Tenant default (tenant_settings.settings.defaultLocale)
 * 5. System default ('en')
 *
 * For internal/MSP users, only checks:
 * 1. User preference
 * 2. Tenant default
 * 3. System default
 *
 * Special handling for portal invitations:
 * When sending portal invitations to contacts without user accounts yet,
 * provide the clientId to ensure the client's defaultLocale is respected.
 */

import { getConnection } from '../db/db';
import { SupportedLocale, isSupportedLocale, LOCALE_CONFIG } from '../i18n/config';
import logger from '@alga-psa/shared/core/logger';

export interface EmailRecipient {
  email: string;
  userId?: string;
  userType?: 'client' | 'internal';
  clientId?: string;
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

    // If we have a userId, check user preference and get user details
    if (recipient.userId) {
      if (!userType) {
        const user = await knex('users')
          .where({
            user_id: recipient.userId,
            tenant: tenantId
          })
          .first();

        userType = user?.user_type || 'internal';
      }

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

    // For client users (or when clientId is provided without userId), check client and client portal settings
    // This handles portal invitations sent to contacts who don't have user accounts yet
    if (userType === 'client' || clientId) {
      // 2. Check client preference
      if (clientId) {
        const client = await knex('clients')
          .where({
            client_id: clientId,
            tenant: tenantId
          })
          .first();

        const clientLocale = client?.properties?.defaultLocale;
        if (clientLocale && isSupportedLocale(clientLocale)) {
          logger.debug('[EmailLocaleResolver] Using client preference:', { locale: clientLocale, clientId });
          return clientLocale;
        }
      }

      // 3. Check tenant client portal default
      const tenantSettings = await knex('tenant_settings')
        .where({ tenant: tenantId })
        .first();

      const clientPortalLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
      if (clientPortalLocale && isSupportedLocale(clientPortalLocale)) {
        logger.debug('[EmailLocaleResolver] Using tenant client portal default:', { locale: clientPortalLocale });
        return clientPortalLocale;
      }
    }

    // 4. Check tenant default (for both internal and client users)
    const defaultLocale = await getTenantDefaultLocale(tenantId, userType || 'client');
    logger.debug('[EmailLocaleResolver] Using tenant/system default:', { locale: defaultLocale, userType: userType || 'client' });
    return defaultLocale;

  } catch (error) {
    logger.error('[EmailLocaleResolver] Error resolving email locale:', { error, tenantId, recipient });
    // Fall back to system default on error
    return LOCALE_CONFIG.defaultLocale as SupportedLocale;
  }
}

/**
 * Get tenant default locale based on user type
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

    // For client users, prefer client portal default
    if (userType === 'client') {
      const clientPortalLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
      if (clientPortalLocale && isSupportedLocale(clientPortalLocale)) {
        return clientPortalLocale;
      }
    }

    // Check tenant-wide default
    const tenantDefaultLocale = tenantSettings?.settings?.defaultLocale;
    if (tenantDefaultLocale && isSupportedLocale(tenantDefaultLocale)) {
      return tenantDefaultLocale;
    }
  } catch (error) {
    logger.error('[EmailLocaleResolver] Error getting tenant default locale:', { error, tenantId });
  }

  // System default
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
