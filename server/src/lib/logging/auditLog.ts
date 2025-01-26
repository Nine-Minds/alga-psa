import { createTenantKnex } from '../db';

interface AuditLogParams {
  userId?: string;
  tenantId: string;
  action: string;
  details: Record<string, unknown>;
}

export async function auditLog(params: AuditLogParams) {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }
  
  try {
    // await knex('audit_logs').insert({
    //   user_id: params.userId,
    //   tenant_id: params.tenantId,
    //   action: params.action,
    //   details: JSON.stringify(params.details),
    //   created_at: new Date()
    // });
  } catch (error) {
    console.error('Failed to write audit log:', error);
    throw new Error('Failed to write audit log');
  }
}