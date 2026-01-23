/**
 * Email Locale Resolver
 *
 * Resolves the appropriate locale for email notifications sent to users.
 */

import { getConnection } from '@alga-psa/db';
import { SupportedLocale, isSupportedLocale, LOCALE_CONFIG } from '@alga-psa/ui/lib/i18n/config';
import logger from '@alga-psa/core/logger';

export interface EmailRecipient {
  email: string;
  userId?: string;
  userType?: 'client' | 'internal';
  clientId?: string;
}

async function getUserClientId(userId: string, tenantId: string): Promise<string | null> {
  try {
    const knex = await getConnection(tenantId);

    const user = await knex('users')
      .where({
        user_id: userId,
        tenant: tenantId
      })
      .first();

    if (!user?.contact_id) return null;

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

export async function resolveEmailLocale(
  tenantId: string,
  recipient: EmailRecipient
): Promise<SupportedLocale> {
  const knex = await getConnection(tenantId);

  try {
    let userType = recipient.userType;
    let clientId = recipient.clientId;

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

      if (!clientId && userType === 'client') {
        const resolvedClientId = await getUserClientId(recipient.userId, tenantId);
        clientId = resolvedClientId ?? undefined;
      }
    }

    if (userType === 'client' || clientId) {
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

      const tenantSettings = await knex('tenant_settings')
        .where({ tenant: tenantId })
        .first();

      const clientPortalLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
      if (clientPortalLocale && isSupportedLocale(clientPortalLocale)) {
        logger.debug('[EmailLocaleResolver] Using tenant client portal default:', { locale: clientPortalLocale });
        return clientPortalLocale;
      }
    }

    const defaultLocale = await getTenantDefaultLocale(tenantId, userType || 'client');
    logger.debug('[EmailLocaleResolver] Using tenant/system default:', { locale: defaultLocale, userType: userType || 'client' });
    return defaultLocale;

  } catch (error) {
    logger.error('[EmailLocaleResolver] Error resolving email locale:', { error, tenantId, recipient });
    return LOCALE_CONFIG.defaultLocale as SupportedLocale;
  }
}

export async function getTenantDefaultLocale(
  tenantId: string,
  userType?: 'client' | 'internal'
): Promise<SupportedLocale> {
  try {
    const knex = await getConnection(tenantId);
    const tenantSettings = await knex('tenant_settings')
      .where({ tenant: tenantId })
      .first();

    if (userType === 'client') {
      const clientPortalLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
      if (clientPortalLocale && isSupportedLocale(clientPortalLocale)) {
        return clientPortalLocale;
      }
    }

    const tenantDefaultLocale = tenantSettings?.settings?.defaultLocale;
    if (tenantDefaultLocale && isSupportedLocale(tenantDefaultLocale)) {
      return tenantDefaultLocale;
    }
  } catch (error) {
    logger.error('[EmailLocaleResolver] Error getting tenant default locale:', { error, tenantId });
  }

  return LOCALE_CONFIG.defaultLocale as SupportedLocale;
}

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
      const contact = await knex('contacts')
        .where({
          contact_name_id: user.contact_id,
          tenant: tenantId
        })
        .first();

      clientId = contact?.client_id || null;
    }

    return {
      email,
      userId: user.user_id,
      userType: user.user_type || 'internal',
      clientId: clientId || undefined
    };
  } catch (error) {
    logger.error('[EmailLocaleResolver] Error getting user info for email:', { error, tenantId, email });
    return { email };
  }
}

