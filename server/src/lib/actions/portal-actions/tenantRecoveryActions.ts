'use server';

import logger from '@alga-psa/shared/core/logger';
import { getAdminConnection } from '@shared/db/admin';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { getPortalDomain } from 'server/src/models/PortalDomainModel';
import { getTenantSlugForTenant } from '../tenant-actions/tenantSlugActions';
import { sendTenantRecoveryEmail, sendNoAccountFoundEmail } from 'server/src/lib/email/clientPortalTenantRecoveryEmail';

export interface TenantLoginInfo {
  tenantId: string;
  tenantName: string;
  loginUrl: string;
  source: 'vanity' | 'canonical';
}

/**
 * Finds all client users with the given email address across all tenants
 */
async function findClientUsersByEmail(email: string): Promise<Array<IUser & { client_name?: string }>> {
  const db = await getAdminConnection();
  try {
    const users = await db<IUser>('users')
      .leftJoin('tenants', 'users.tenant', 'tenants.tenant')
      .select(
        'users.*',
        'tenants.client_name'
      )
      .where({
        'users.email': email.toLowerCase(),
        'users.user_type': 'client',
        'users.is_inactive': false
      });

    return users;
  } catch (error) {
    logger.error(`Error finding client users with email ${email}:`, error);
    throw error;
  }
}

/**
 * Builds a portal login link for the given tenant
 */
async function buildPortalLoginLink(tenantId: string, callbackUrl?: string): Promise<{ url: string; source: 'vanity' | 'canonical' }> {
  const db = await getAdminConnection();

  try {
    const tenantSlug = await getTenantSlugForTenant(tenantId);
    const portalDomain = await getPortalDomain(db, tenantId);

    // Prefer vanity domain if active
    if (portalDomain && portalDomain.status === 'active' && portalDomain.domain) {
      const url = new URL(`https://${portalDomain.domain}/auth/client-portal/signin`);
      if (callbackUrl) {
        url.searchParams.set('callbackUrl', callbackUrl);
      }
      return {
        url: url.toString(),
        source: 'vanity',
      };
    }

    // Fall back to canonical with tenant slug
    const canonicalBase =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      (process.env.HOST ? `https://${process.env.HOST}` : '');

    if (!canonicalBase) {
      throw new Error('NEXTAUTH_URL (or NEXT_PUBLIC_BASE_URL) must be configured to compute canonical login links');
    }

    const loginUrl = new URL(
      '/auth/client-portal/signin',
      canonicalBase.endsWith('/') ? canonicalBase : `${canonicalBase}/`
    );
    loginUrl.searchParams.set('tenant', tenantSlug);
    if (callbackUrl) {
      loginUrl.searchParams.set('callbackUrl', callbackUrl);
    }

    return {
      url: loginUrl.toString(),
      source: 'canonical',
    };
  } catch (error) {
    logger.error('[buildPortalLoginLink] Failed to build login link', {
      tenantId,
      error: error instanceof Error ? error.message : error,
    });
    throw error;
  }
}

/**
 * Requests tenant login links for a given email address.
 * Returns a generic success message to prevent account enumeration.
 */
export async function requestTenantLoginLinksAction(
  email: string,
  callbackUrl?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    logger.info('[requestTenantLoginLinksAction] Request received', { email: email.toLowerCase() });

    // Find all client users with this email
    const users = await findClientUsersByEmail(email);

    if (users.length === 0) {
      // Send a generic email to prevent account enumeration
      logger.info('[requestTenantLoginLinksAction] No users found for email', { email: email.toLowerCase() });

      try {
        await sendNoAccountFoundEmail(email);
        logger.info('[requestTenantLoginLinksAction] No-account email sent', { email: email.toLowerCase() });
      } catch (emailError) {
        logger.error('[requestTenantLoginLinksAction] Failed to send no-account email:', emailError);
        // Continue anyway to prevent enumeration
      }

      return {
        success: true,
        message: 'If an account exists with that email, login links have been sent.',
      };
    }

    // Build login info for each tenant
    const tenantLoginInfos: TenantLoginInfo[] = await Promise.all(
      users.map(async (user) => {
        const { url, source } = await buildPortalLoginLink(user.tenant, callbackUrl);
        return {
          tenantId: user.tenant,
          tenantName: user.client_name || 'Unknown Organization',
          loginUrl: url,
          source,
        };
      })
    );

    // Send recovery email with all login links
    await sendTenantRecoveryEmail(email, tenantLoginInfos);

    logger.info('[requestTenantLoginLinksAction] Recovery email sent', {
      email: email.toLowerCase(),
      tenantCount: tenantLoginInfos.length,
    });

    return {
      success: true,
      message: 'If an account exists with that email, login links have been sent.',
    };
  } catch (error) {
    logger.error('[requestTenantLoginLinksAction] Error processing request:', error);
    // Return generic success message even on error to prevent enumeration
    return {
      success: true,
      message: 'If an account exists with that email, login links have been sent.',
    };
  }
}
