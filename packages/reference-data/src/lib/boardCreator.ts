import type { Knex } from 'knex';

/**
 * The one board create, reachable from this package.
 *
 * A board is created in exactly one place — `createBoardCore` in `@alga-psa/tickets` — so an
 * imported board is the same as one made in settings: its kind, its default priority (R7), its
 * statuses, an ITIL board's own copy of the standard categories and its SLA policy. This package
 * cannot import that function (the tickets package already depends on this one), so the tickets
 * package registers it here at startup, the way the SLA hooks are registered on `globalThis` from
 * `server/src/lib/initializeApp.ts` (F111 of `ee/plans/2026-11-21-itil-remediation`).
 *
 * LEVERAGE: pattern global-keyed-registry — see `packages/tickets/src/lib/slaIntegrationHooks.ts`;
 * held on `globalThis` because Next builds separate module instances for startup code and for
 * server actions.
 */

export interface BoardCreatorActor {
  userId: string;
  userType?: string;
}

/** The board row an import or a wizard has prepared, in the shape the board create accepts. */
export type BoardCreatorInput = Record<string, unknown> & { board_name: string };

export type BoardCreator = (
  trx: Knex.Transaction,
  tenant: string,
  actor: BoardCreatorActor,
  board: BoardCreatorInput
) => Promise<Record<string, any>>;

const STORE_KEY = Symbol.for('alga.referenceData.boardCreator');

function store(): { create: BoardCreator | null } {
  const host = globalThis as unknown as Record<symbol, { create: BoardCreator | null } | undefined>;
  return (host[STORE_KEY] ??= { create: null });
}

export function registerBoardCreator(create: BoardCreator): void {
  store().create = create;
}

export function getBoardCreator(): BoardCreator | null {
  return store().create;
}

export function isBoardCreatorRegistered(): boolean {
  return store().create !== null;
}

/**
 * The creator, or a loud failure. An import that inserted the board itself would be the second
 * create path this plan exists to remove, so a runtime without the registration refuses the import
 * rather than producing a board that differs from a created one.
 */
export function requireBoardCreator(): BoardCreator {
  const create = getBoardCreator();
  if (!create) {
    throw new Error(
      'No board create is registered. Call registerBoardLifecycle() at startup of this runtime ' +
        '(server/src/lib/initializeApp.ts) before importing or seeding boards.'
    );
  }
  return create;
}

/** Test seam: forget the registration. Never called by product code. */
export function clearBoardCreatorForTest(): void {
  store().create = null;
}
