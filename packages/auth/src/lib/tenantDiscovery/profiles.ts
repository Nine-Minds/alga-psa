import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin';
import { tenantDb } from '@alga-psa/db';

const TENANT_DISCOVERY_CONTEXT = 'tenant-recovery-discovery';

export type TenantDiscoveryUserType = 'client' | 'internal';
export type TenantDiscoverySurface = 'client_portal' | 'msp';
export type TenantDiscoveryTemplateName = 'tenant-recovery' | 'msp-tenant-recovery';

/**
 * Everything that differs between "find me my organizations" for client-portal
 * users and for MSP users. A value, not a flag set: the engine reads these
 * fields and never branches on which profile it was handed.
 */
export interface TenantDiscoveryProfile {
  /** `users.user_type` whose live accounts are discovered. */
  userType: TenantDiscoveryUserType;
  /** App surface handed to `resolveTenantAppBase` to pick the link origin. */
  surface: TenantDiscoverySurface;
  /** Path of the sign-in page the emailed link opens. */
  signInPath: string;
  /** `system_email_templates.name` rendered for the email. */
  templateName: TenantDiscoveryTemplateName;
  /**
   * Gate evaluated after the rate limit and before any user lookup. A failed
   * precondition answers with the same generic response as every other outcome.
   */
  precondition?: (email: string) => Promise<boolean>;
  /**
   * Whether a link on the tenant's vanity host still carries `?tenant=<slug>`.
   * Client-portal vanity hosts identify their tenant, so their links stay bare.
   * MSP vanity hosts do not resolve a tenant for internal credentials, so a
   * bare link would hit TENANT_REQUIRED again.
   */
  vanityScopesTenant: boolean;
}

/**
 * Checks if an email exists as an active contact across all tenants.
 */
async function isEmailAContact(email: string): Promise<boolean> {
  const db = await getAdminConnection();
  try {
    const contact = await tenantDb(db, TENANT_DISCOVERY_CONTEXT)
      .unscoped('contacts', 'tenant discovery for client portal recovery contact email lookup')
      .where('contacts.email', email.toLowerCase())
      .andWhere('contacts.is_inactive', false)
      .first();

    return !!contact;
  } catch (error) {
    logger.error(`Error checking if email is a contact ${email}:`, error);
    throw error;
  }
}

export const CLIENT_TENANT_DISCOVERY_PROFILE: TenantDiscoveryProfile = {
  userType: 'client',
  surface: 'client_portal',
  signInPath: '/auth/client-portal/signin',
  templateName: 'tenant-recovery',
  precondition: isEmailAContact,
  vanityScopesTenant: false,
};

export const INTERNAL_TENANT_DISCOVERY_PROFILE: TenantDiscoveryProfile = {
  userType: 'internal',
  surface: 'msp',
  signInPath: '/auth/msp/signin',
  templateName: 'msp-tenant-recovery',
  vanityScopesTenant: true,
};
