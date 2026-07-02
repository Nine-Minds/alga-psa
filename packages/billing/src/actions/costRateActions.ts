'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IUserCostRate } from '@alga-psa/types';
import UserCostRate, {
  CostRateValidationError,
  type CostRateValidationCode,
  type UpsertUserCostRateInput,
} from '../models/userCostRate';

export interface CostRateActionError {
  code: CostRateValidationCode | 'permission_denied' | 'no_tenant';
  message: string;
}

export interface CostRateUserRow {
  user_id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_inactive: boolean;
  current_rate: IUserCostRate | null;
  rate_history: IUserCostRate[];
}

export interface ListCostRatesResult {
  default_rate_history: IUserCostRate[];
  users: CostRateUserRow[];
}

export interface UpsertCostRateResult {
  rate: IUserCostRate;
  covers_worked_time: boolean;
}

export interface DeleteCostRateResult {
  deleted_rate: IUserCostRate;
  covers_worked_time: boolean;
}

export type UpsertCostRateActionInput = Omit<UpsertUserCostRateInput, 'created_by'>;

export interface CostRateWorkedTimeImpactInput {
  user_id: string | null;
  effective_from: string;
  effective_to?: string | null;
}

function requireTenant(tenant: string | null | undefined): string {
  if (!tenant) {
    const error = new Error('No tenant context') as Error & { code?: CostRateActionError['code'] };
    error.code = 'no_tenant';
    throw error;
  }

  return tenant;
}

function currentRateFor(history: IUserCostRate[], today: string): IUserCostRate | null {
  return history.find((rate) => (
    rate.effective_from <= today && (!rate.effective_to || rate.effective_to >= today)
  )) ?? null;
}

export const listCostRates = withAuth(async (
  user,
  { tenant }
): Promise<ListCostRatesResult> => {
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }

  const tenantId = requireTenant(tenant);
  const { knex } = await createTenantKnex();
  const rates = await UserCostRate.list(knex, tenantId);
  const ratesByUser = new Map<string | null, IUserCostRate[]>();

  for (const rate of rates) {
    const key = rate.user_id ?? null;
    const bucket = ratesByUser.get(key) ?? [];
    bucket.push(rate);
    ratesByUser.set(key, bucket);
  }

  const users = await tenantDb(knex, tenantId).table('users')
    .where({ user_type: 'internal' })
    .select('user_id', 'username', 'first_name', 'last_name', 'email', 'is_inactive')
    .orderBy([{ column: 'first_name', order: 'asc' }, { column: 'last_name', order: 'asc' }, { column: 'username', order: 'asc' }]);

  const today = new Date().toISOString().slice(0, 10);

  return {
    default_rate_history: ratesByUser.get(null) ?? [],
    users: users.map((row: Record<string, unknown>) => {
      const history = ratesByUser.get(row.user_id as string) ?? [];
      return {
        user_id: row.user_id as string,
        username: row.username as string,
        first_name: (row.first_name as string | null | undefined) ?? null,
        last_name: (row.last_name as string | null | undefined) ?? null,
        email: (row.email as string | null | undefined) ?? null,
        is_inactive: Boolean(row.is_inactive),
        current_rate: currentRateFor(history, today),
        rate_history: history,
      };
    }),
  };
});

export const upsertCostRate = withAuth(async (
  user,
  { tenant },
  input: UpsertCostRateActionInput
): Promise<UpsertCostRateResult> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    throw new Error('Permission denied: billing update required');
  }

  const tenantId = requireTenant(tenant);
  const { knex } = await createTenantKnex();

  try {
    const rate = await UserCostRate.upsert(knex, tenantId, {
      ...input,
      created_by: user.user_id,
    });
    const coversWorkedTime = await UserCostRate.coversWorkedTime(
      knex,
      tenantId,
      rate.user_id,
      rate.effective_from,
      rate.effective_to
    );

    return { rate, covers_worked_time: coversWorkedTime };
  } catch (error) {
    if (error instanceof CostRateValidationError) {
      throw error;
    }
    throw error;
  }
});

export const deleteCostRate = withAuth(async (
  user,
  { tenant },
  rateId: string
): Promise<DeleteCostRateResult> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    throw new Error('Permission denied: billing update required');
  }

  const tenantId = requireTenant(tenant);
  const { knex } = await createTenantKnex();
  const existing = await UserCostRate.getById(knex, tenantId, rateId);
  if (!existing) {
    throw new CostRateValidationError('rate_not_found', 'Cost rate not found.');
  }

  const coversWorkedTime = await UserCostRate.coversWorkedTime(
    knex,
    tenantId,
    existing.user_id,
    existing.effective_from,
    existing.effective_to
  );
  const deletedRate = await UserCostRate.delete(knex, tenantId, rateId);

  return { deleted_rate: deletedRate, covers_worked_time: coversWorkedTime };
});

export const checkCostRateWorkedTimeImpact = withAuth(async (
  user,
  { tenant },
  input: CostRateWorkedTimeImpactInput
): Promise<{ covers_worked_time: boolean }> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    throw new Error('Permission denied: billing update required');
  }

  const tenantId = requireTenant(tenant);
  const { knex } = await createTenantKnex();
  const coversWorkedTime = await UserCostRate.coversWorkedTime(
    knex,
    tenantId,
    input.user_id,
    input.effective_from,
    input.effective_to ?? null
  );

  return { covers_worked_time: coversWorkedTime };
});
