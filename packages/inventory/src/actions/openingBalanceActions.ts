'use server';

import type { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  applyOpeningBalance,
  validateOpeningBalance,
} from '../lib/openingBalanceCsv';
import type {
  OpeningBalanceApplyResult,
  OpeningBalanceOptions,
  OpeningBalanceValidation,
} from '../lib/openingBalanceCsv';

async function requireInvPerm(user: any, action: 'create' | 'read' | 'update' | 'delete'): Promise<void> {
  if (!(await hasPermission(user, 'inventory', action))) {
    throw new Error(`Permission denied: inventory ${action} required`);
  }
}

export type OpeningBalanceActionError = ActionMessageError | ActionPermissionError;

function openingBalanceActionErrorFrom(error: unknown): OpeningBalanceActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }
    if (error.message.startsWith('Opening balance import failed validation:')) {
      return actionError(error.message);
    }
  }

  const dbError = error as { code?: string };
  if (dbError?.code === '23503') {
    return actionError('One of the selected opening-balance records is no longer valid. Validate the file again and retry.');
  }
  if (dbError?.code === '23505') {
    return actionError('The import conflicts with existing inventory records. Validate the file again and retry.');
  }

  return null;
}

async function withOpeningBalanceActionErrors<T>(work: () => Promise<T>): Promise<T | OpeningBalanceActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = openingBalanceActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

export const validateOpeningBalanceImport = withAuth(
  async (user, { tenant }, csvText: string, opts?: OpeningBalanceOptions): Promise<OpeningBalanceValidation | OpeningBalanceActionError> => {
    return withOpeningBalanceActionErrors(async () => {
      await requireInvPerm(user, 'create');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) =>
        validateOpeningBalance(trx, tenant, csvText, opts),
      );
    });
  },
);

export const applyOpeningBalanceImport = withAuth(
  async (user, { tenant }, csvText: string, opts?: OpeningBalanceOptions): Promise<OpeningBalanceApplyResult | OpeningBalanceActionError> => {
    return withOpeningBalanceActionErrors(async () => {
      await requireInvPerm(user, 'create');
      const { knex: db } = await createTenantKnex();
      return withTransaction(db, async (trx: Knex.Transaction) =>
        applyOpeningBalance(trx, tenant, user.user_id, csvText, opts),
      );
    });
  },
);

export type {
  OpeningBalanceApplyResult,
  OpeningBalanceOptions,
  OpeningBalancePreviewRow,
  OpeningBalanceRowError,
  OpeningBalanceValidation,
  OpeningBalanceWarning,
} from '../lib/openingBalanceCsv';
