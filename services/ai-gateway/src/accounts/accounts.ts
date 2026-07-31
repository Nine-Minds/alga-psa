import type { Knex } from 'knex';

import type { AiAccountRow, DeploymentType } from '../db/types.js';
import {
  calculateGraceLimit,
  loadTierConfig,
  type TierConfigLoader,
} from '../tier/tierConfig.js';

export interface CreateAccountInput {
  tenantId: string;
  deploymentType: DeploymentType;
}

export async function findOrCreateAccount(
  database: Knex,
  input: CreateAccountInput,
  getTierConfig: TierConfigLoader = () => loadTierConfig(database),
): Promise<AiAccountRow> {
  if (!input.tenantId) {
    throw new Error('tenantId is required');
  }

  const existing = await database<AiAccountRow>('ai_accounts')
    .where({
      tenant_id: input.tenantId,
      deployment_type: input.deploymentType,
    })
    .first();
  if (existing) {
    return existing;
  }

  const tierConfig = await getTierConfig();
  const graceLimitCredits = calculateGraceLimit(tierConfig);
  const now = new Date();
  const insertedRows = (await database('ai_accounts')
    .insert({
      tenant_id: input.tenantId,
      deployment_type: input.deploymentType,
      subscription_status: 'none',
      included_balance: '0',
      topup_balance: '0',
      grace_limit_credits: graceLimitCredits.toString(),
      low_balance_threshold: tierConfig.lowBalanceThreshold.toString(),
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

  const conflictedAccount = await database<AiAccountRow>('ai_accounts')
    .where({
      tenant_id: input.tenantId,
      deployment_type: input.deploymentType,
    })
    .first();

  if (!conflictedAccount) {
    throw new Error('Account creation conflicted, but the existing account could not be loaded');
  }

  return conflictedAccount;
}
