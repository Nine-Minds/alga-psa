/**
 * Credential vault audit writer (EE-only).
 *
 * Every sensitive credential action writes an audit row inside the same
 * transaction as the operation, with the `app.current_tenant` GUC set (the
 * auditLog helper skips inserts when the GUC is unset). Reveal audit is
 * fail-closed: the caller writes the row BEFORE any value is returned and a
 * failed insert throws, so no audit row ⇒ no value. Audit `details` never
 * contain values.
 */

import type { Knex } from 'knex';
import { auditLog } from 'server/src/lib/logging/auditLog';

export type CredentialAuditOperation =
  | 'credential_reveal'
  | 'credential_otp_seed_reveal'
  | 'credential_created'
  | 'credential_updated'
  | 'credential_deleted'
  | 'credential_grants_changed';

export interface CredentialAuditParams {
  userId: string;
  credentialId: string;
  clientId: string;
}

export async function writeCredentialAudit(
  knex: Knex | Knex.Transaction,
  tenant: string,
  operation: CredentialAuditOperation,
  params: CredentialAuditParams,
  details: Record<string, unknown> = {}
): Promise<void> {
  await knex.transaction(async (trx) => {
    await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
    await auditLog(trx, {
      userId: params.userId,
      operation,
      tableName: 'credentials',
      recordId: params.credentialId,
      changedData: {},
      details: {
        integration: 'alga',
        tenant,
        credential_id: params.credentialId,
        client_id: params.clientId,
        ...details,
      },
    });
  });
}
