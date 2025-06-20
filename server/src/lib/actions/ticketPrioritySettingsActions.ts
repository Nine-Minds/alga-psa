'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { ITicketPrioritySettings, PriorityLevel, IPriorityMatrixEntry } from 'server/src/interfaces';

export type PriorityMatrix = Record<PriorityLevel, Record<PriorityLevel, string>>;

export const DEFAULT_MATRIX: PriorityMatrix = {
  low: { low: '', medium: '', high: '' },
  medium: { low: '', medium: '', high: '' },
  high: { low: '', medium: '', high: '' }
};

function matrixToArray(matrix: PriorityMatrix): IPriorityMatrixEntry[] {
  const entries: IPriorityMatrixEntry[] = [];
  (['low','medium','high'] as PriorityLevel[]).forEach(impact => {
    (['low','medium','high'] as PriorityLevel[]).forEach(urgency => {
      entries.push({ impact, urgency, priority_id: matrix[impact][urgency] });
    });
  });
  return entries;
}

function arrayToMatrix(entries: IPriorityMatrixEntry[] | null): PriorityMatrix {
  const matrix: PriorityMatrix = JSON.parse(JSON.stringify(DEFAULT_MATRIX));
  if (!entries) return matrix;
  for (const e of entries) {
    if (matrix[e.impact]) {
      matrix[e.impact][e.urgency] = e.priority_id;
    }
  }
  return matrix;
}

export async function getTicketPrioritySettings(): Promise<{ usePriorityMatrix: boolean; priorityMatrix: PriorityMatrix }> {
  const { knex, tenant } = await createTenantKnex();
  const row = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('ticket_priority_settings').where({ tenant }).first();
  });

  if (!row) {
    return { usePriorityMatrix: false, priorityMatrix: DEFAULT_MATRIX };
  }

  return {
    usePriorityMatrix: row.use_priority_matrix,
    priorityMatrix: arrayToMatrix(row.priority_matrix)
  };
}

export async function updateTicketPrioritySettings(settings: { usePriorityMatrix: boolean; priorityMatrix: PriorityMatrix }): Promise<{ success: boolean }> {
  const { knex, tenant } = await createTenantKnex();
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const existing = await trx('ticket_priority_settings').where({ tenant }).first();
    const data = {
      use_priority_matrix: settings.usePriorityMatrix,
      priority_matrix: JSON.stringify(matrixToArray(settings.priorityMatrix)),
      updated_at: trx.fn.now()
    };
    if (existing) {
      await trx('ticket_priority_settings').where({ tenant }).update(data);
    } else {
      await trx('ticket_priority_settings').insert({ ...data, tenant });
    }
  });

  return { success: true };
}
