import { Knex } from 'knex';
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