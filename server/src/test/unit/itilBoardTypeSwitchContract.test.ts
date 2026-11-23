/**
 * T206, T208, T209 (wiring) — F113–F121 of `ee/plans/2026-11-21-itil-remediation`
 * (`board-type-switch`).
 *
 * The switch is one function behind the board mutation guard, the board update runs it instead of
 * flipping kinds on the side, and every string the confirmation shows exists in every locale. The
 * behaviour is in `src/test/integration/itilBoardTypeSwitch.integration.test.ts`, and the dialog
 * itself in `packages/tickets/src/components/settings/BoardsSettings.boardTypeSwitch.test.tsx`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const LOCALES_DIR = path.resolve(REPO_ROOT, 'server/public/locales');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

const CORE = 'packages/tickets/src/services/boardLifecycle.ts';

describe('ITIL board type switch wiring', () => {
  it('T197: both switch actions sit behind the board mutation guard', () => {
    const actions = source('packages/tickets/src/actions/board-actions/boardActions.ts');
    for (const action of ['getBoardTypeSwitchSummary', 'switchBoardType']) {
      const body = actions.slice(actions.indexOf(`export const ${action} = withAuth(`));
      expect(body.slice(0, 700), `${action} must run the guard first`).toContain(
        "boardMutationGuard(user, 'update'"
      );
      expect(body.slice(0, 1_200)).toContain('if (guard.ok === false) {');
    }
  });

  it('T203: the switch assigns no SLA policy and creates none (D1/D6)', () => {
    const core = source(CORE);
    const body = core.slice(core.indexOf('export async function switchBoardTypeCore('));
    // It seeds the rows the new kind needs, and nothing else: no ITIL SLA hook, no policy write.
    expect(body).toContain('ItilStandardsService.copyItilPrioritiesToTenant(');
    expect(body).toContain('ItilStandardsService.copyItilCategoriesToTenant(');
    expect(body).not.toContain('handleItilConfiguration');
    expect(body).not.toContain('sla_policy_id');
    // And it deletes nothing: priorities are tenant-wide, categories belong to the board (D9).
    expect(body).not.toContain('cleanupUnusedItilStandards');
  });

  it('T208: the board update runs the switch rather than flipping kinds itself', () => {
    const core = source(CORE);
    const update = core.slice(
      core.indexOf('export async function updateBoardCore('),
      core.indexOf('export interface DeleteBoardResult')
    );
    expect(update).toContain('switchBoardTypeCore(trx, tenant, actor, boardId, nextPriorityKind, { publish: false })');
    // The old side-effects are gone from the update.
    expect(update).not.toContain('handleItilConfiguration');
    expect(update).not.toContain('cleanupUnusedItilStandards');
  });

  it('T206: the settings screen asks for the summary before it switches', () => {
    const screen = source('packages/tickets/src/components/settings/BoardsSettings.tsx');
    expect(screen).toContain('const openBoardTypeSwitch = async (board: IBoard) => {');
    expect(screen).toContain('await getBoardTypeSwitchSummary(board.board_id as string, kind)');
    const confirm = screen.slice(screen.indexOf('const confirmBoardTypeSwitch = async () => {'));
    expect(confirm.slice(0, 600)).toContain('await switchBoardType(boardTypeSwitch.summary.boardId, boardTypeSwitch.kind)');
    // The kind of an existing board is shown, not edited: the ITIL switch stays create-only.
    expect(screen).toContain('{!editingBoard && (');
    expect(screen).toContain('id="board-change-type-button"');
    expect(screen).toContain('id="board-change-type-dialog"');
  });

  it('T209: every board-type string exists in every locale', () => {
    const locales = fs
      .readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(locales).toContain('en');
    expect(locales.length).toBeGreaterThanOrEqual(10);

    const dialogKeys = [
      'changeBoardTypeTitle',
      'changeBoardTypeConfirm',
      'changeBoardTypeToItil',
      'changeBoardTypeToCustom',
      'changeBoardTypeKeeps',
      'changeBoardTypeTickets',
      'changeBoardTypeInboundDefaults',
      'changeBoardTypeTemplates',
      'changeBoardTypeSchedules',
      'changeBoardTypeSlaNone',
      'changeBoardTypeSlaNoTargets',
      'changeBoardTypeSlaOk',
    ];

    for (const locale of locales) {
      const bundle = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, locale, 'msp/settings.json'), 'utf8')
      );
      const boards = bundle.ticketing?.boards;
      expect(typeof boards?.actions?.changeBoardType, `${locale}: actions.changeBoardType`).toBe('string');
      for (const field of ['label', 'itil', 'custom', 'mixed']) {
        expect(typeof boards?.fields?.boardType?.[field], `${locale}: fields.boardType.${field}`).toBe('string');
      }
      for (const key of dialogKeys) {
        expect(typeof boards?.dialog?.[key], `${locale}: dialog.${key}`).toBe('string');
      }
      // The interpolations the screen passes have to survive translation.
      expect(boards.fields.boardType.mixed, `${locale}: mixed`).toContain('{{categories}}');
      expect(boards.fields.boardType.mixed, `${locale}: mixed`).toContain('{{priorities}}');
      expect(boards.dialog.changeBoardTypeToItil, `${locale}: toItil`).toContain('{{board}}');
      expect(boards.dialog.changeBoardTypeTickets, `${locale}: tickets`).toContain('{{count}}');
      expect(boards.dialog.changeBoardTypeSlaNoTargets, `${locale}: slaNoTargets`).toContain('{{policy}}');
    }
  });
});
