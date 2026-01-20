import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

interface AuditLogParams {
  userId?: string;
  operation: string;
  tableName: string;
  recordId: string;
  changedData: Record<string, unknown>;
  details: Record<string, unknown>;
}

export async function auditLog(
  knex: Knex,
  params: AuditLogParams
) {
  try {
    // If the current request hasn't established the tenant GUC, skip logging to avoid aborting the transaction.
    try {
      const tenantCheck = await knex.raw("select current_setting('app.current_tenant', true) as tenant");
      const tenantValue = Array.isArray(tenantCheck?.rows)
        ? tenantCheck.rows[0]?.tenant
        : (tenantCheck as any)?.[0]?.tenant;

      if (!tenantValue) {
        console.warn('Skipping audit log insert; app.current_tenant GUC is unavailable in this context.');
        return;
      }
    } catch (gucError) {
      console.warn('Skipping audit log insert; unable to read app.current_tenant GUC.', gucError);
      return;
    }

    await knex('audit_logs').insert({
      audit_id: uuidv4(),
      user_id: params.userId,
      operation: params.operation,
      table_name: params.tableName,
      record_id: params.recordId,
      changed_data: params.changedData,
      details: params.details,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
    throw new Error('Failed to write audit log');
  }
}
