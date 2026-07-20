import type { Knex } from 'knex';

import { parseBigint, type BigintValue } from '../db/bigint.js';
import type { AiAccountRow, DeploymentType } from '../db/types.js';

export interface CreateAccountInput {
  tenantId: string;
  deploymentType: DeploymentType;
  graceLimitCredits?: BigintValue;
  lowBalanceThreshold?: BigintValue;
}

export async function findOrCreateAccount(
  database: Knex,
  input: CreateAccountInput,
): Promise<AiAccountRow> {
  if (!input.tenantId) {
    throw new Error('tenantId is required');
  }

  const graceLimitCredits = parseBigint(input.graceLimitCredits ?? 0n, 'graceLimitCredits');
  const lowBalanceThreshold = parseBigint(
    input.lowBalanceThreshold ?? 0n,
    'lowBalanceThreshold',
  );

  if (graceLimitCredits < 0n) {
    throw new Error('graceLimitCredits must be non-negative');
  }
  if (lowBalanceThreshold < 0n) {
    throw new Error('lowBalanceThreshold must be non-negative');
  }

  const now = new Date();
  const insertedRows = (await database('ai_accounts')
    .insert({
      tenant_id: input.tenantId,
      deployment_type: input.deploymentType,
      subscription_status: 'none',
      included_balance: '0',
      topup_balance: '0',
      grace_limit_credits: graceLimitCredits.toString(),
      low_balance_threshold: lowBalanceThreshold.toString(),
      auto_topup_enabled: false,
      auto_topup_failure_count: 0,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['tenant_id', 'deployment_type'])
    .ignore()
    .returning('*')) as AiAccountRow[];

  const inserted = insertedRows[0];
  if (inserted) {
    return inserted;
  }

  const existing = await database<AiAccountRow>('ai_accounts')
    .where({
      tenant_id: input.tenantId,
      deployment_type: input.deploymentType,
    })
    .first();

  if (!existing) {
    throw new Error('Account creation conflicted, but the existing account could not be loaded');
  }

  return existing;
}
