import { createTenantKnex } from '../db';
import type { IUserWithRoles } from '../types';

interface AuditLogParams {
  userId?: string;
  tenantId: string;
  action: string;
  details: Record<string, unknown>;
}

export async function auditLog(params: AuditLogParams) {
  const db = createTenantKnex(params.tenantId);
  
  try {
    await db('audit_logs').insert({
      user_id: params.userId,
      tenant_id: params.tenantId,
      action: params.action,
      details: JSON.stringify(params.details),
      created_at: new Date()
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
    throw new Error('Failed to write audit log');
  }
}