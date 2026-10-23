import { c4 } from './proxies';
import type { UpdateTenantArgs, UpdateTenantResult } from './types';

/** Edit company name / contact on the registry tenant. */
export async function applianceUpdateTenantWorkflow(args: UpdateTenantArgs): Promise<UpdateTenantResult> {
  const tenant = await c4.c4UpdateTenant({
    tenantId: args.tenantId,
    companyName: args.companyName,
    contactName: args.contactName,
    contactEmail: args.contactEmail,
  });
  return {
    tenant: {
      tenant_id: tenant.tenant_id,
      company_name: tenant.company_name,
      contact_name: tenant.contact_name,
      contact_email: tenant.contact_email,
    },
  };
}
