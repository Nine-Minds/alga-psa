/**
 * Audit sink for Hudu password reveals (F068).
 *
 * Writes to the shared `audit_logs` table via the repo's auditLog util.
 * audit_logs stamps `tenant` from the `app.current_tenant` GUC (BEFORE INSERT
 * trigger) and auditLog SKIPS when the GUC is unset, so we set it
 * transaction-locally first (expiredCreditsHandler precedent). Failures
 * propagate — the caller fails CLOSED (no audit row ⇒ no value returned).
 * The entry records who/when/which only; it never contains the value.
 */

import type { Knex } from 'knex';
import { auditLog } from 'server/src/lib/logging/auditLog';

export interface HuduPasswordRevealAuditParams {
  userId: string;
  clientId: string;
  huduPasswordId: string | number;
  huduCompanyId: string | number;
}

export async function writeHuduPasswordRevealAudit(
  knex: Knex,
  tenant: string,
  params: HuduPasswordRevealAuditParams
): Promise<void> {
  await knex.transaction(async (trx) => {
    await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenant]);
    await auditLog(trx, {
      userId: params.userId,
      operation: 'hudu_password_reveal',
      tableName: 'clients',
      recordId: params.clientId,
      changedData: {},
      details: {
        integration: 'hudu',
        tenant,
        hudu_password_id: String(params.huduPasswordId),
        hudu_company_id: String(params.huduCompanyId),
        revealed_at: new Date().toISOString(),
      },
    });
  });
}
