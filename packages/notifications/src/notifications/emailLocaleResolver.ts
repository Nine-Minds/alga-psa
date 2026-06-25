/**
 * Email Locale Resolver
 *
 * Resolves the appropriate locale for email notifications sent to users.
 */

import { createTenantScopedQuery, getConnection } from '@alga-psa/db';
import { SupportedLocale, isSupportedLocale, LOCALE_CONFIG } from '@alga-psa/core/i18n/config';
import logger from '@alga-psa/core/logger';
import type { Knex } from 'knex';

export interface EmailRecipient {
  email: string;
  userId?: string;
  userType?: 'client' | 'internal';
  clientId?: string;
}

function tenantScopedTable(knex: Knex, table: string, tenantId: string) {
  return createTenantScopedQuery(knex, {
    table,
    tenant: tenantId,
  }).builder;
}

async function getUserClientId(userId: string, tenantId: string): Promise<string | null> {
  try {
    const knex = await getConnection(tenantId);

    const user = await tenantScopedTable(knex, 'users', tenantId)
      .where({
        user_id: userId,
      })
      .first();

    if (!user?.contact_id) return null;

    const contact = await tenantScopedTable(knex, 'contacts', tenantId)
      .where({
        contact_name_id: user.contact_id,
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

    if (recipient.userId && !userType) {
      const user = await tenantScopedTable(knex, 'users', tenantId)
        .where({
          user_id: recipient.userId,
        })
        .first();

      userType = user?.user_type || 'internal';
    }

    if (recipient.userId) {
      const userPref = await tenantScopedTable(knex, 'user_preferences', tenantId)
        .where({
          user_id: recipient.userId,
          setting_name: 'locale',
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

    // Client-specific default (client-portal users / portal invitations only)
    if ((userType === 'client' || clientId) && clientId) {
      const client = await tenantScopedTable(knex, 'clients', tenantId)
        .where({ client_id: clientId })
        .first();

      const clientLocale = client?.properties?.defaultLocale;
      if (clientLocale && isSupportedLocale(clientLocale)) {
        logger.debug('[EmailLocaleResolver] Using client preference:', { locale: clientLocale, clientId });
        return clientLocale;
      }
    }

    // Client-portal default (client-portal users only)
    if (userType === 'client' || clientId) {
      const tenantSettings = await tenantScopedTable(knex, 'tenant_settings', tenantId)
        .first();

      const clientPortalLocale = tenantSettings?.settings?.clientPortal?.defaultLocale;
      if (clientPortalLocale && isSupportedLocale(clientPortalLocale)) {
        logger.debug('[EmailLocaleResolver] Using client-portal default:', { locale: clientPortalLocale });
        return clientPortalLocale;
      }
    }

    // Organization default (applies to everyone; legacy MSP fallback inside)
    const defaultLocale = await getTenantDefaultLocale(tenantId, userType || 'client');
    logger.debug('[EmailLocaleResolver] Using org/system default:', { locale: defaultLocale, userType: userType || 'client' });
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
    const tenantSettings = await tenantScopedTable(knex, 'tenant_settings', tenantId)
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

    const user = await tenantScopedTable(knex, 'users', tenantId)
      .where({
        email
      })
      .first();

    if (!user) {
      return { email };
    }

    let clientId: string | null = null;
    if (user.user_type === 'client' && user.contact_id) {
      const contact = await tenantScopedTable(knex, 'contacts', tenantId)
        .where({
          contact_name_id: user.contact_id
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
