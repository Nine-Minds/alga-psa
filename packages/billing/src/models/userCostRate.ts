import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { IUserCostRate } from '@alga-psa/types';

export type CostRateValidationCode =
  | 'invalid_range'
  | 'invalid_rate'
  | 'overlap'
  | 'user_not_found'
  | 'rate_not_found';

export class CostRateValidationError extends Error {
  readonly code: CostRateValidationCode;

  constructor(code: CostRateValidationCode, message: string) {
    super(message);
    this.name = 'CostRateValidationError';
    this.code = code;
  }
}

export interface UpsertUserCostRateInput {
  rate_id?: string;
  user_id: string | null;
  cost_rate: number;
  effective_from: string;
  effective_to?: string | null;
  created_by?: string | null;
}

const TABLE = 'user_cost_rates';

function assertTenant(tenant: string): void {
  if (!tenant) {
    throw new Error('Tenant context is required for user cost rates');
  }
}

function normalizeDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

function normalizeRate(row: Record<string, unknown>): IUserCostRate {
  return {
    tenant: row.tenant as string,
    rate_id: row.rate_id as string,
    user_id: (row.user_id as string | null) ?? null,
    cost_rate: Number(row.cost_rate ?? 0),
    effective_from: normalizeDateOnly(row.effective_from as string | Date) ?? '',
    effective_to: normalizeDateOnly(row.effective_to as string | Date | null),
    created_at: row.created_at as Date | string | undefined,
    updated_at: row.updated_at as Date | string | undefined,
    created_by: (row.created_by as string | null | undefined) ?? null,
  };
}

function validateInput(input: UpsertUserCostRateInput): void {
  if (!Number.isInteger(input.cost_rate) || input.cost_rate < 0) {
    throw new CostRateValidationError('invalid_rate', 'Cost rate must be a non-negative integer number of cents per hour.');
  }

  if (!input.effective_from) {
    throw new CostRateValidationError('invalid_range', 'Effective start date is required.');
  }

  if (input.effective_to && input.effective_to < input.effective_from) {
    throw new CostRateValidationError('invalid_range', 'Effective end date must be on or after the start date.');
  }
}

function lockKey(tenant: string, userId: string | null): string {
  return `${tenant}:${userId ?? 'default'}`;
}

export function buildCostRateResolutionLateralJoin(
  entryAlias: string,
  rateAlias = 'resolved_cost_rate'
): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entryAlias) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(rateAlias)) {
    throw new Error('SQL aliases must be simple identifiers');
  }

  return `
LEFT JOIN LATERAL (
  SELECT ucr.rate_id, ucr.cost_rate, ucr.user_id
  FROM user_cost_rates ucr
  WHERE ucr.tenant = ${entryAlias}.tenant
    AND (ucr.user_id = ${entryAlias}.user_id OR ucr.user_id IS NULL)
    AND ucr.effective_from <= ${entryAlias}.work_date
    AND (ucr.effective_to IS NULL OR ucr.effective_to >= ${entryAlias}.work_date)
  ORDER BY ucr.user_id IS NULL, ucr.effective_from DESC, ucr.rate_id
  LIMIT 1
) AS ${rateAlias} ON true`;
}

export const UserCostRate = {
  async list(knexOrTrx: Knex | Knex.Transaction, tenant: string): Promise<IUserCostRate[]> {
    assertTenant(tenant);

    const rows = await tenantDb(knexOrTrx, tenant).table(TABLE)
      .select('*')
      .orderBy([{ column: 'user_id', order: 'asc' }, { column: 'effective_from', order: 'desc' }]);

    return rows.map((row: Record<string, unknown>) => normalizeRate(row));
  },

  async listByUser(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    userId: string | null
  ): Promise<IUserCostRate[]> {
    assertTenant(tenant);

    const query = tenantDb(knexOrTrx, tenant).table(TABLE).select('*');
    if (userId === null) {
      query.whereNull('user_id');
    } else {
      query.where({ user_id: userId });
    }

    const rows = await query.orderBy('effective_from', 'desc');
    return rows.map((row: Record<string, unknown>) => normalizeRate(row));
  },

  async getById(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    rateId: string
  ): Promise<IUserCostRate | null> {
    assertTenant(tenant);

    const row = await tenantDb(knexOrTrx, tenant).table(TABLE)
      .where({ rate_id: rateId })
      .first();

    return row ? normalizeRate(row) : null;
  },

  async resolveCostRate(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    userId: string,
    workDate: string
  ): Promise<IUserCostRate | null> {
    assertTenant(tenant);

    const row = await tenantDb(knexOrTrx, tenant).table(`${TABLE} as ucr`)
      .where((builder) => {
        builder.where('ucr.user_id', userId).orWhereNull('ucr.user_id');
      })
      .where('ucr.effective_from', '<=', workDate)
      .andWhere((builder) => {
        builder.whereNull('ucr.effective_to').orWhere('ucr.effective_to', '>=', workDate);
      })
      .select('ucr.*')
      .orderByRaw('ucr.user_id IS NULL')
      .orderBy('ucr.effective_from', 'desc')
      .orderBy('ucr.rate_id', 'asc')
      .first();

    return row ? normalizeRate(row) : null;
  },

  async upsert(
    knex: Knex | Knex.Transaction,
    tenant: string,
    input: UpsertUserCostRateInput
  ): Promise<IUserCostRate> {
    assertTenant(tenant);
    validateInput(input);

    return withTransaction(knex, async (trx) => {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [lockKey(tenant, input.user_id)]);

      if (input.user_id) {
        await this.assertInternalUserExists(trx, tenant, input.user_id);
      }

      await this.assertNoOverlap(trx, tenant, input);

      const now = trx.fn.now();
      const rateId = input.rate_id ?? uuidv4();
      const row = {
        tenant,
        rate_id: rateId,
        user_id: input.user_id,
        cost_rate: input.cost_rate,
        effective_from: input.effective_from,
        effective_to: input.effective_to ?? null,
        updated_at: now,
        ...(input.rate_id ? {} : { created_at: now, created_by: input.created_by ?? null }),
      };

      if (input.rate_id) {
        const updated = await tenantDb(trx, tenant).table(TABLE)
          .where({ rate_id: input.rate_id })
          .update(row)
          .returning('*');

        if (updated.length === 0) {
          throw new CostRateValidationError('rate_not_found', 'Cost rate not found.');
        }

        return normalizeRate(updated[0]);
      }

      const inserted = await tenantDb(trx, tenant).table(TABLE)
        .insert(row)
        .returning('*');

      return normalizeRate(inserted[0]);
    });
  },

  async delete(knex: Knex | Knex.Transaction, tenant: string, rateId: string): Promise<IUserCostRate> {
    assertTenant(tenant);

    return withTransaction(knex, async (trx) => {
      const existing = await this.getById(trx, tenant, rateId);
      if (!existing) {
        throw new CostRateValidationError('rate_not_found', 'Cost rate not found.');
      }

      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [lockKey(tenant, existing.user_id)]);

      await tenantDb(trx, tenant).table(TABLE)
        .where({ rate_id: rateId })
        .delete();

      return existing;
    });
  },

  async coversWorkedTime(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    userId: string | null,
    effectiveFrom: string,
    effectiveTo?: string | null
  ): Promise<boolean> {
    assertTenant(tenant);

    const query = tenantDb(knexOrTrx, tenant).table('time_entries')
      .where('work_date', '>=', effectiveFrom);

    if (effectiveTo) {
      query.andWhere('work_date', '<=', effectiveTo);
    }

    if (userId) {
      query.andWhere({ user_id: userId });
    }

    const row = await query.count<{ count: string }[]>({ count: '*' }).first();
    return Number(row?.count ?? 0) > 0;
  },

  async assertInternalUserExists(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    userId: string
  ): Promise<void> {
    const user = await tenantDb(knexOrTrx, tenant).table('users')
      .where({ user_id: userId, user_type: 'internal' })
      .select('user_id')
      .first();

    if (!user) {
      throw new CostRateValidationError('user_not_found', 'Internal user not found for this tenant.');
    }
  },

  async assertNoOverlap(
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    input: UpsertUserCostRateInput
  ): Promise<void> {
    const query = tenantDb(knexOrTrx, tenant).table(TABLE)
      .select('rate_id')
      .where('effective_from', '<=', knexOrTrx.raw('COALESCE(?::date, \'infinity\'::date)', [input.effective_to ?? null]))
      .andWhereRaw('?::date <= COALESCE(effective_to, \'infinity\'::date)', [input.effective_from]);

    if (input.user_id === null) {
      query.whereNull('user_id');
    } else {
      query.where({ user_id: input.user_id });
    }

    if (input.rate_id) {
      query.andWhere('rate_id', '<>', input.rate_id);
    }

    const overlap = await query.first();
    if (overlap) {
      throw new CostRateValidationError('overlap', 'Cost rate effective dates overlap an existing rate for this scope.');
    }
  },
};

export default UserCostRate;
