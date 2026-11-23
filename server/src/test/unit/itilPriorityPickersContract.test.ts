/**
 * T172–T183 (wiring) — F092–F102 of `ee/plans/2026-11-21-itil-remediation` (`priority-pickers`).
 *
 * Every priority picker narrows its list by the board it is picking for, through one helper
 * (`filterPrioritiesForBoard`) on the client and the canonical board-scoped lister on the server.
 * The helper's own behaviour is `packages/tickets/src/lib/boardDefaultPriority.test.ts`; the
 * server listers run against a database in `src/test/integration/itilPriorityPickers.integration.test.ts`.
 * What this file keeps honest is that no picker has a second copy of the rule.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

/** Every `@alga-psa/*` package imported anywhere under a source tree — the build graph's edges. */
function importedPackages(relativeDir: string): string[] {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const match of text.matchAll(/(?:from|import|require\()\s*['"](@alga-psa\/[^'"/]+)/g)) {
        found.add(match[1]);
      }
    }
  };
  walk(path.resolve(REPO_ROOT, relativeDir));
  return [...found].sort();
}

/** Files that render or configure a ticket priority list. */
const PICKER_FILES = [
  'packages/tickets/src/components/QuickAddTicket.tsx',
  'packages/tickets/src/components/ticket/TicketInfo.tsx',
  'packages/tickets/src/components/ticket/bento/BentoHero.tsx',
  'packages/tickets/src/components/settings/BoardsSettings.tsx',
  'packages/tickets/src/components/TicketImportDialog.tsx',
  'packages/surveys/src/components/triggers/TriggerForm.tsx',
  'server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx',
  'packages/assets/src/components/CreateTicketFromAssetButton.tsx',
  'ee/server/src/components/settings/integrations/HuntressIntegrationSettings.tsx',
];

describe('ITIL priority picker wiring', () => {
  it('T172: every client picker filters through the one helper, and none keeps its own family test', () => {
    for (const file of PICKER_FILES) {
      const text = source(file);
      expect(text, `${file} must filter priorities through the shared helper`).toContain(
        'filterPrioritiesForBoard('
      );
      // The copies this group removed: a hand-written family comparison in a picker.
      const ownFamilyTest =
        /priority_type\s*===\s*'itil'\s*\n?\s*\?\s*Boolean\(/.test(text) ||
        /\.filter\(\([^)]*\)\s*=>\s*!?[a-zA-Z.]*is_from_itil_standard\)/.test(text);
      expect(ownFamilyTest, `${file} still has its own copy of the family rule`).toBe(false);
    }
  });

  it('T173: both workflow designer pickers carry the family and narrow by the fixed board', () => {
    for (const file of [
      'ee/server/src/components/workflow-designer/WorkflowActionInputFixedPicker.tsx',
      'ee/packages/workflows/src/components/automation-hub/WorkflowActionInputFixedPicker.tsx',
    ]) {
      const text = source(file);
      expect(text).toContain('isFromItilStandard: priority.is_from_itil_standard ?? null');
      const narrowing = text.slice(text.indexOf("case 'ticket-priority': {"));
      expect(narrowing.slice(0, 900)).toContain("dependencyValues.get('board_id')");
      expect(narrowing.slice(0, 900)).toContain(
        "Boolean(option.isFromItilStandard) === (board.priority_type === 'itil')"
      );
    }
    // The option payload carries both halves of the rule.
    expect(source('packages/types/src/lib/email.ts')).toContain('priority_type?: string | null');
    expect(source('packages/types/src/lib/email.ts')).toContain('is_from_itil_standard?: boolean | null');
    expect(source('packages/integrations/src/actions/email-actions/ticketFieldOptionsActions.ts')).toContain(
      "'board_id as id', 'board_name as name', 'is_default', 'priority_type'"
    );
    // The two create-side actions declare the board their priority picker depends on.
    expect(source('shared/workflow/runtime/actions/businessOperations/tickets.ts')).toContain(
      "priority_id: withWorkflowPicker(uuidSchema, 'Priority id', 'ticket-priority', ['board_id'])"
    );
    expect(source('shared/workflow/runtime/actions/businessOperations/assetMaintenance.ts')).toContain(
      "priority_id: withWorkflowPicker(uuidSchema, 'Priority id', 'ticket-priority', ['board_id'])"
    );
  });

  it('T174: the Huntress severity map is offered the selected board’s priorities', () => {
    const actions = source('ee/server/src/lib/actions/integrations/huntressActions.ts');
    expect(actions).toContain("'board_id', 'board_name', 'priority_type'");
    expect(actions).toContain("'priority_id', 'priority_name', 'is_from_itil_standard'");
    const screen = source('ee/server/src/components/settings/integrations/HuntressIntegrationSettings.tsx');
    expect(screen).toContain('const selectedBoardPriorityType = routingOptions?.boards.find');
    expect(screen).toContain('filterPrioritiesForBoard(');
  });

  it('T175: co-managed lists and accepts only the priorities of the ticket’s board', () => {
    const editing = source('packages/co-managed/src/ticketEditing.ts');
    expect(editing).toContain(
      "query.where('is_from_itil_standard', boardFieldKind(board?.priority_type) === 'itil')"
    );
    const write = editing.slice(editing.indexOf('if (request.patch.priority_id)'));
    expect(write.slice(0, 700)).toContain('findBoardFieldProblems(context.trx, resource.tenant, {');
    expect(write.slice(0, 700)).toContain("throw new CoManagedTicketEditError('INVALID_TICKET_EDIT')");
  });

  it('T176, T177: the service request editor and the from-asset dialog filter by the selected board', () => {
    const editor = source('server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx');
    expect(editor).toContain(
      'filterPrioritiesForBoard(ticketRoutingPriorities, ticketRoutingBoardConfig?.priority_type)'
    );
    // Its own copy of the board-default rule is gone; it uses the shared one.
    expect(editor).not.toContain('function getDefaultPriorityId(');
    expect(editor).toContain("from '@alga-psa/tickets/lib/boardDefaultPriority'");

    const asset = source('packages/assets/src/components/CreateTicketFromAssetButton.tsx');
    expect(asset).toContain('boards.find((candidate) => candidate.board_id === board)?.priority_type');
    // @alga-psa/tickets depends on assets through inventory, so the dialog reaches the one helper
    // through shared. Importing the tickets copy closes a build cycle and nx refuses the build.
    expect(asset).toContain("from '@alga-psa/shared/lib/tickets/boardPriorityOptions'");
    expect(importedPackages('packages/assets/src')).not.toContain('@alga-psa/tickets');
  });

  it('T178: the Activities inline picker asks for the ticket board’s priorities', () => {
    const picker = source('packages/user-activities/src/components/InlinePriorityPicker.tsx');
    expect(picker).toContain("getPrioritiesByBoardType(boardId, 'ticket')");
    // The cache cannot serve one board's list to another.
    expect(picker).toContain('const key = `${itemType}:${boardId ?? \'\'}`');
  });

  it('T179: the CSV import dialog maps each priority against the boards its rows target', () => {
    const dialog = source('packages/tickets/src/components/TicketImportDialog.tsx');
    expect(dialog).toContain('const priorityBoardKindsByName = useMemo(');
    expect(dialog).toContain('const rowKinds = priorityBoardKinds(info.name);');
    expect(dialog).toContain("const createRefused = rowKinds.has('itil');");
    // The mapping list and the "create new" option both follow the rows, not the default board.
    expect(dialog).toContain('options={mappable.map(p => ({ value: p.priority_id, label: p.priority_name }))}');
    expect(dialog).toContain('...(!createRefused ?');
  });

  it('T180: the webhook and RMM rule lookups offer ticket priorities only', () => {
    const webhook = source('server/src/lib/actions/inboundWebhookLookups.ts');
    const priorityCase = webhook.slice(webhook.indexOf("case 'ticket_priority': {"));
    expect(priorityCase.slice(0, 1_200)).toContain("where({ item_type: 'ticket' })");
    expect(priorityCase.slice(0, 1_200)).toContain(
      "query.andWhere('is_from_itil_standard', boardFieldKind(priorityBoard.priority_type) === 'itil')"
    );

    const rmm = source('packages/integrations/src/actions/integrations/rmmAlertRuleActions.ts');
    const options = rmm.slice(rmm.indexOf('const [boards, priorities, closedStatuses, users, organizations]'));
    expect(options.slice(0, 900)).toContain("where({ item_type: 'ticket' })");
  });

  it('T181: GET /api/v1/tickets/priorities takes a board and returns the level', () => {
    const route = source('server/src/app/api/v1/tickets/priorities/route.ts');
    expect(route).toContain("req.nextUrl.searchParams.get('board_id')");
    expect(route).toContain('listPrioritiesForBoard(knex, tenantId, boardId, \'ticket\')');
    expect(route).toContain('itil_priority_level');
    // Without a board the answer is unchanged: every ticket priority.
    const withoutBoard = route.slice(route.lastIndexOf("const priorities = await tenantDb("));
    expect(withoutBoard).toContain("where({ item_type: 'ticket' })");
  });

  it('T182: mobile asks the API for the ticket board’s priorities', () => {
    expect(source('ee/mobile/src/api/tickets.ts')).toContain(
      'const query = params.boardId ? `?board_id=${encodeURIComponent(params.boardId)}` : "";'
    );
    const hook = source('ee/mobile/src/features/ticketDetail/hooks/useTicketPriority.ts');
    expect(hook).toContain('boardId: deps.boardId ?? null');
    expect(hook).toContain('priorityOptions: deps.boardId');
    expect(source('ee/mobile/src/screens/TicketDetailScreen.tsx')).toContain('boardId: boardId ?? null');
  });

  it('T183: the shared helper is the only client-side family rule left in the repo', () => {
    const roots = ['packages', 'server/src', 'ee/server/src', 'ee/packages'];
    const skip = new Set(['node_modules', 'dist', '.next', 'build', '__snapshots__']);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx$/.test(entry.name) || /\.(test|spec)\.tsx$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, 'utf8');
        // A component deciding a priority's family for itself, rather than asking the helper.
        if (/\.filter\(\([^)]*\)\s*=>\s*!?[a-zA-Z.]*\.?is_from_itil_standard[^a-zA-Z_]/.test(text)) {
          offenders.push(path.relative(REPO_ROOT, full));
        }
      }
    };
    for (const root of roots) {
      const full = path.resolve(REPO_ROOT, root);
      if (fs.existsSync(full)) walk(full);
    }

    expect(offenders.sort(), 'components filtering priorities by family on their own').toEqual([]);
  });
});
