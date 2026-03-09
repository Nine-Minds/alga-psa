/**
 * Server actions for email domain management
 */

'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';

interface DomainStatus {
  domain: string;
  status: 'pending' | 'verified' | 'failed';
  dnsRecords?: Array<{
    type: string;
    name: string;
    value: string;
  }>;
  verifiedAt?: string;
  createdAt?: string;
  providerId?: string;
  providerDomainId?: string;
}

export const getEmailDomains = withAuth(async (
  _user,
  { tenant }
): Promise<DomainStatus[]> => {
  const { knex } = await createTenantKnex();

  try {
    const domains = await knex('email_domains')
      .where({ tenant_id: tenant })
      .select('*')
      .orderBy('created_at', 'desc');

    const domainStatuses: DomainStatus[] = domains.map((domain: any) => ({
      domain: domain.domain_name,
      status: domain.status,
      dnsRecords: domain.dns_records ? JSON.parse(domain.dns_records) : [],
      verifiedAt: domain.verified_at,
      createdAt: domain.created_at,
      providerId: domain.provider_id,
      providerDomainId: domain.provider_domain_id
    }));

    return domainStatuses;
  } catch (error: any) {
    console.error('Error fetching domains:', error);
    throw new Error('Failed to fetch domains');
  }
});

export const addEmailDomain = withAuth(async (
  user,
  { tenant },
  domainName: string
): Promise<{ success: boolean; message: string }> => {
  // Validate domain format
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
  if (!domainRegex.test(domainName)) {
    throw new Error('Invalid domain format');
  }

  const { knex } = await createTenantKnex();

  try {
    // Check if domain already exists
    const existing = await knex('email_domains')
      .where({ tenant: tenant, domain_name: domainName })
      .first();

    if (existing) {
      throw new Error('Domain already exists');
    }

    // Insert domain record
    const domainData = {
      tenant: tenant,
      domain_name: domainName,
      status: 'pending',
      created_at: new Date(),
      updated_at: new Date()
    };

    await knex('email_domains').insert(domainData);

    return {
      success: true,
      message: 'Domain added'
    };
  } catch (error: any) {
    console.error('Error adding domain:', error);
    throw new Error(error.message || 'Failed to add domain');
  }
});

export const verifyEmailDomain = withAuth(async (
  user,
  { tenant },
  domainName: string
): Promise<{ success: boolean; message: string }> => {
  const { knex } = await createTenantKnex();

  try {
    // Check if domain exists
    const domain = await knex('email_domains')
      .where({ tenant: tenant, domain_name: domainName })
      .first();

    if (!domain) {
      throw new Error('Domain not found');
    }

    return {
      success: true,
      message: 'Verification requested'
    };
  } catch (error: any) {
    console.error('Error verifying domain:', error);
    throw new Error(error.message || 'Failed to verify domain');
  }
});

export const deleteEmailDomain = withAuth(async (
  _user,
  { tenant },
  domainName: string
): Promise<{ success: boolean; message: string }> => {
  const { knex } = await createTenantKnex();

  try {
    // Check if domain exists
    const domain = await knex('email_domains')
      .where({ tenant: tenant, domain_name: domainName })
      .first();

    if (!domain) {
      throw new Error('Domain not found');
    }

    // Delete from provider if it was successfully created
    if (domain.provider_domain_id && domain.provider_id) {
      try {
        // TODO: Implement provider-specific domain deletion
        // This would use the EmailProviderManager to delete from Resend/etc.
        console.log(`[EmailDomains] Should delete domain ${domain.provider_domain_id} from provider ${domain.provider_id}`);
      } catch (providerError: any) {
        console.error('[EmailDomains] Failed to delete domain from provider:', providerError);
        // Continue with database deletion even if provider deletion fails
      }
    }

    // Delete from database
    await knex('email_domains')
      .where({ tenant: tenant, domain_name: domainName })
      .del();

    return {
      success: true,
      message: 'Domain deleted successfully'
    };
  } catch (error: any) {
    console.error('Error deleting domain:', error);
    throw new Error(error.message || 'Failed to delete domain');
  }
});
