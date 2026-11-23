import type { Knex } from 'knex';
import { registerBoardCreator } from '@alga-psa/reference-data/lib/boardCreator';
import type { BoardCreatorActor, BoardCreatorInput } from '@alga-psa/reference-data/lib/boardCreator';
import { CREATE_BOARD_INPUT_KEYS, createBoardInputSchema } from '../actions/board-actions/boardInputSchema';
import { createBoardCore } from './boardLifecycle';

/**
 * F111: one board create for every caller. `@alga-psa/reference-data` cannot import this package
 * (the dependency runs the other way), so the board create is registered with it at startup — the
 * way the SLA hooks are registered from `server/src/lib/initializeApp.ts` — and the reference-data
 * import then creates a board exactly as the settings screen does: same kind check, same default
 * priority (R7), same statuses, and an ITIL board's own category set and SLA policy.
 */
export function registerBoardLifecycle(): void {
  registerBoardCreator(async (
    trx: Knex.Transaction,
    tenant: string,
    actor: BoardCreatorActor,
    board: BoardCreatorInput
  ) => {
    const writable: Record<string, unknown> = {};
    for (const key of CREATE_BOARD_INPUT_KEYS) {
      if (board[key] !== undefined) writable[key] = board[key];
    }
    return createBoardCore(trx, tenant, { userId: actor.userId }, createBoardInputSchema.parse(writable));
  });
}
