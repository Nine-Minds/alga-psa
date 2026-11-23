/**
 * T184–T196 (wiring) — F103–F112 of `ee/plans/2026-11-21-itil-remediation` (`board-lifecycle`).
 *
 * One implementation of board create, update and delete, with the server actions and the REST
 * service adding nothing but authentication, a transaction and error shaping. The behaviour is in
 * `src/test/integration/itilBoardLifecycle.integration.test.ts`; what this file keeps honest is
 * that neither caller grows a second copy of the lifecycle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

const ACTIONS = 'packages/tickets/src/actions/board-actions/boardActions.ts';
const SERVICE = 'server/src/lib/api/services/BoardService.ts';
const CORE = 'packages/tickets/src/services/boardLifecycle.ts';

describe('ITIL board lifecycle wiring', () => {
  it('T184: the board actions keep the guard and hand the work to the core functions', () => {
    const actions = source(ACTIONS);
    for (const symbol of ['createBoardCore(trx, tenant,', 'updateBoardCore(trx, tenant,', 'deleteBoardCore({ db, trx }, tenant,']) {
      expect(actions, `boardActions must call ${symbol}`).toContain(symbol);
    }
    // The guard is still the first thing each of the three does.
    for (const action of ['create', 'update', 'delete']) {
      expect(actions).toContain(`boardMutationGuard(user, '${action}'`);
    }
    // And the board's shape is no longer decided here: no board insert, no ITIL setup, no status
    // seeding, no category sweep.
    expect(actions).not.toContain("tenantScopedTable('boards')\n        .insert(");
    expect(actions).not.toContain('ItilStandardsService');
    expect(actions).not.toContain('deleteEntityWithValidation');
  });

  it('T185, T186, T195, T196: the REST service calls the same three functions and nothing else', () => {
    const service = source(SERVICE);
    expect(service).toContain("from '@alga-psa/tickets/services/boardLifecycle'");
    expect(service).toContain('createBoardCore(trx, tenant, { userId: context.userId }, writable as never)');
    expect(service).toContain('updateBoardCore(trx, tenant, { userId: context.userId }, id, writable as never)');
    expect(service).toContain('deleteBoardCore({ db: knex, trx }, tenant, { userId: context.userId }, id, {');
    // It no longer writes the board row itself, nor publishes the events the core publishes.
    expect(service).not.toContain('addCreateAuditFields');
    expect(service).not.toContain("eventType: 'BOARD_CREATED'");
    expect(service).not.toContain('super.delete(');
    // A refused shape is the caller's to fix.
    expect(service).toContain('rethrowBoardLifecycleRefusal');
  });

  it('T187, T188: the create settles its default priority through R7, after the ITIL setup', () => {
    const core = source(CORE);
    const create = core.slice(core.indexOf('export async function createBoardCore('));
    const body = create.slice(0, create.indexOf('\nexport '));
    expect(body).toContain('defaultPriorityForBoardRow(trx, tenant, {');
    expect(body.indexOf('ItilStandardsService.handleItilConfiguration')).toBeLessThan(
      body.indexOf('defaultPriorityForBoardRow(trx, tenant, {')
    );
    // The statuses are seeded after both, so a board is never half-built.
    expect(body.indexOf('defaultPriorityForBoardRow(trx, tenant, {')).toBeLessThan(
      body.indexOf('seedBoardTicketStatusesFromStandards(')
    );
    // No local copy of the priority rule is left.
    expect(body).not.toContain('CASE WHEN itil_priority_level = 3');
  });

  it('T189, T190, T191: R1 and the default-priority family are checked in the core, for both callers', () => {
    const core = source(CORE);
    expect(core).toContain('export const MIXED_BOARD_KINDS_MESSAGE');
    expect(core).toContain('async function assertDefaultPriorityFitsKind(');
    const create = core.slice(core.indexOf('export async function createBoardCore('), core.indexOf('export async function updateBoardCore('));
    expect(create).toContain('if (categoryKind !== priorityKind) {');
    expect(create).toContain('assertDefaultPriorityFitsKind(trx, tenant, boardData.default_priority_id, priorityKind)');
    const update = core.slice(core.indexOf('export async function updateBoardCore('));
    expect(update).toContain('if (touchesKind && nextCategoryKind !== nextPriorityKind) {');
    expect(update).toContain('assertDefaultPriorityFitsKind(trx, tenant, boardData.default_priority_id, nextPriorityKind)');
  });

  it('T192, T193: the create stores the default team and returns the row after setup', () => {
    const core = source(CORE);
    expect(core).toContain('default_assigned_team_id: boardData.default_assigned_team_id || null');
    const create = core.slice(core.indexOf('export async function createBoardCore('));
    expect(create.slice(0, create.indexOf('\nexport '))).toContain('const createdBoard = ((await tenantScopedTable<IBoard>(\'boards\')');
    expect(create).toContain('changes: { after: createdBoard }');
  });

  it('T194: the reference-data import and the onboarding wizard produce a usable board', () => {
    // Onboarding can call the core (it already depends on the tickets package).
    const onboarding = source('packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts');
    expect(onboarding).toContain("import { createBoardCore } from '@alga-psa/tickets/services/boardLifecycle'");
    expect(onboarding).toContain('const createdBoard = await createBoardCore(');

    // The reference-data import cannot: `tickets` depends on `reference-data`, so a direct call
    // would be a cycle (the package says so itself at its board delete). It takes R7 from the
    // shared rules module both sides use instead.
    const referenceData = source('packages/reference-data/src/actions/referenceDataActions.ts');
    expect(referenceData).toContain("import { defaultPriorityForBoard } from '@alga-psa/shared/lib/tickets/boardFieldRules'");
    expect(referenceData).toContain('defaultPriorityForBoard(trx, tenant, savedItem.board_id)');
    expect(referenceData).not.toContain("from '@alga-psa/tickets");
  });
});
