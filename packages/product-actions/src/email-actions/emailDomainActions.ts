/**
 * Server actions for email domain management
 */

'use server';

import { createTenantKnex } from '@server/lib/db';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { getWorkflowRuntime } from '@shared/workflow/core/workflowRuntime';
import { getActionRegistry } from '@shared/workflow/core/index';

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

export async function getEmailDomains(): Promise<DomainStatus[]> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();

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
}

export async function addEmailDomain(domainName: string): Promise<{ success: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  // Validate domain format
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
  if (!domainRegex.test(domainName)) {
    throw new Error('Invalid domain format');
  }

  const { knex, tenant } = await createTenantKnex();

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

    // Trigger domain verification workflow
    try {
      const workflowRuntime = getWorkflowRuntime(getActionRegistry());
      
      await workflowRuntime.startWorkflowByVersionId(knex, {
        versionId: 'domain_verification',
        tenant: tenant || '',
        initialData: {
          tenantId: tenant,
          domain: domainName
        },
        userId: user.user_id,
        isSystemManaged: false
      });

      console.log(`[EmailDomains] Started domain verification workflow for ${domainName}`);
    } catch (workflowError: any) {
      console.error('[EmailDomains] Failed to start domain verification workflow:', workflowError);
      // Don't fail the action if workflow fails - domain is still added
    }

    return {
      success: true,
      message: 'Domain added and verification process started'
    };
  } catch (error: any) {
    console.error('Error adding domain:', error);
    throw new Error(error.message || 'Failed to add domain');
  }
}

export async function verifyEmailDomain(domainName: string): Promise<{ success: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();

  try {
    // Check if domain exists
    const domain = await knex('email_domains')
      .where({ tenant: tenant, domain_name: domainName })
      .first();

    if (!domain) {
      throw new Error('Domain not found');
    }

    // Trigger domain verification workflow event
    try {
      const workflowRuntime = getWorkflowRuntime(getActionRegistry());
      
      // Find active workflow for this domain
      const activeWorkflow = await knex('workflow_executions')
        .where({ 
          tenant: tenant,
          status: 'running'
        })
        .whereRaw("initial_data->>'domain' = ?", [domainName])
        .first();

      if (activeWorkflow) {
        // Send DNS_CONFIGURED event to the workflow
        await workflowRuntime.submitEvent(knex, {
          execution_id: activeWorkflow.execution_id,
          event_name: 'DNS_CONFIGURED',
          payload: {
            domain: domainName,
            tenantId: tenant
          },
          tenant: tenant || ''
        });

        console.log(`[EmailDomains] Sent DNS_CONFIGURED event for ${domainName}`);
      } else {
        // Start new verification workflow
        await workflowRuntime.startWorkflowByVersionId(knex, {
          versionId: 'domain_verification',
          tenant: tenant || '',
          initialData: {
            tenantId: tenant,
            domain: domainName,
            skipDNSWait: true // Skip waiting since user says it's configured
          },
          userId: user.user_id,
          isSystemManaged: false
        });

        console.log(`[EmailDomains] Started new verification workflow for ${domainName}`);
      }
    } catch (workflowError: any) {
      console.error('[EmailDomains] Failed to trigger verification workflow:', workflowError);
      throw new Error('Failed to trigger verification process');
    }

    return {
      success: true,
      message: 'Verification process triggered'
    };
  } catch (error: any) {
    console.error('Error verifying domain:', error);
    throw new Error(error.message || 'Failed to verify domain');
  }
}

export async function deleteEmailDomain(domainName: string): Promise<{ success: boolean; message: string }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();

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
}
