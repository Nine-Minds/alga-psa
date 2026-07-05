'use server';

import type { Knex } from 'knex';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
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

export const validateOpeningBalanceImport = withAuth(
  async (user, { tenant }, csvText: string, opts?: OpeningBalanceOptions): Promise<OpeningBalanceValidation> => {
    await requireInvPerm(user, 'create');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) =>
      validateOpeningBalance(trx, tenant, csvText, opts),
    );
  },
);

export const applyOpeningBalanceImport = withAuth(
  async (user, { tenant }, csvText: string, opts?: OpeningBalanceOptions): Promise<OpeningBalanceApplyResult> => {
    await requireInvPerm(user, 'create');
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) =>
      applyOpeningBalance(trx, tenant, user.user_id, csvText, opts),
    );
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
