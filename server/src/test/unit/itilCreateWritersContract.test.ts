/**
 * T136–T154 (wiring) — F069–F081 of `ee/plans/2026-11-21-itil-remediation` (`writers-create`).
 *
 * The wiring half of the group: the rule lives inside `TicketModel.createTicket`, every create
 * path reaches it, and each path passes the policy the PRD's refuse/fall-back table gives it (R6).
 * The behaviour is in `src/test/integration/itilCreateWriters.integration.test.ts`; what can
 * silently regress is a writer quietly switching policy, or a new create path that passes neither.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

/** The text of the call that reaches the create funnel, from the writer's own file. */
function createCall(relativePath: string, anchor: string): string {
  const text = source(relativePath);
  const index = text.indexOf(anchor);
  expect(index, `${relativePath} no longer contains ${anchor}`).toBeGreaterThan(-1);
  return text.slice(index, index + 2_600);
}

describe('ITIL create writers wiring', () => {
  it('T136: the rule runs inside the create funnel, before the row is assembled', () => {
    const model = source('shared/models/ticketModel.ts');
    expect(model).toContain('static async applyBoardFieldRules(');
    expect(model).toContain('await this.applyBoardFieldRules(cleanedInput, tenant, trx,');
    expect(model).toContain("validationOptions.boardFieldPolicy ?? 'refuse'");
    // The rules are applied before the insert row is built, so the stored values are the resolved
    // ones and not the submitted ones.
    expect(model.indexOf('await this.applyBoardFieldRules(')).toBeLessThan(
      model.indexOf('const ticketData = buildTicketCreateRow(')
    );
    // One implementation: the model asks the shared module, it does not re-derive the rule.
    expect(model).toContain("from '../lib/tickets/boardFieldRules'");
    expect(model).toContain('prepareTicketCreateFields(trx, tenant,');
  });

  it('T136: the shared create rule translates a standard category before it checks it (F081)', () => {
    const rules = source('shared/lib/tickets/boardFieldRules.ts');
    const prepare = rules.slice(rules.indexOf('export async function prepareTicketCreateFields('));
    expect(prepare.indexOf('translateStandardCategoryPairForBoard')).toBeGreaterThan(-1);
    expect(prepare.indexOf('translateStandardCategoryPairForBoard')).toBeLessThan(
      prepare.indexOf('findBoardFieldProblems')
    );
  });

  it('T137: the client portal reports a refused board field as a field error', () => {
    const portal = source('packages/client-portal/src/actions/client-portal-actions/client-tickets.ts');
    expect(portal).toContain("import { isBoardFieldRuleError } from '@alga-psa/shared/lib/tickets/boardFieldRules'");
    const mapper = portal.slice(
      portal.indexOf('function toClientTicketActionError('),
      portal.indexOf('function ticketNotFoundError(')
    );
    expect(mapper).toContain('isBoardFieldRuleError(error)');
    expect(mapper).toContain('actionError(error.message, error.messageKey, error.messageParams)');
    // The portal is a refuse path (R6): it must not ask the funnel to repair the value.
    expect(createCall(
      'packages/client-portal/src/actions/client-portal-actions/client-tickets.ts',
      'const ticketResult = await TicketModel.createTicketWithRetry('
    )).not.toContain('boardFieldPolicy');
  });

  it('T138: the CSV import checks each row against the row’s board and reports per row', () => {
    const importAction = source('packages/tickets/src/actions/ticketImportActions.ts');
    expect(importAction).toContain('prepareTicketCreateFields(trx, tenant, {');
    expect(importAction).toContain("policy: 'refuse'");
    // Every row is checked against its own destination board, through the memoised helper.
    expect(importAction).toContain(
      'prepareRowFields(destinationBoardId, rowPriorityId, resolvedCategoryId || null)'
    );
    // The memo may not blur two rows together: the board, the priority and the category all key it,
    // so a row on another board never reuses this board's answer.
    const memo = importAction.slice(
      importAction.indexOf('const prepareRowFields = async ('),
      importAction.indexOf('// Pre-load statuses')
    );
    expect(memo).toContain('const key = `${boardId}');
    expect(memo).toContain('${priorityId');
    expect(memo).toContain('${categoryId');
    expect(memo).toContain('boardId,');
    // A failing row is reported and skipped, not thrown: one bad row never stops the import.
    const check = importAction.slice(importAction.indexOf('const rowPriorityId ='));
    expect(check.slice(0, 1_400)).toContain('ticketsSkipped++');
  });

  it('T139: the CSV import’s fallback priority is the destination board’s default (R7)', () => {
    const importAction = source('packages/tickets/src/actions/ticketImportActions.ts');
    expect(importAction).toContain('defaultPriorityForBoard(trx, tenant, boardId)');
    // The tenant-wide "first priority by order_number" fallback is gone.
    expect(importAction).not.toContain('const fallbackPriorityId');
  });

  it('T140: Teams, guest intake and the manual telephony ticket take the board default from the shared rule', () => {
    const teams = source('ee/packages/microsoft-teams/src/lib/teams/actions/teamsActionRegistry.ts');
    expect(teams).toContain("import { defaultPriorityForBoard } from '@shared/lib/tickets/boardFieldRules'");
    const resolver = teams.slice(
      teams.indexOf('export async function resolveDefaultPriorityIdForBoard('),
      teams.indexOf('async function findTicketByMessageActionIdempotencyKey(')
    );
    expect(resolver).toContain('defaultPriorityForBoard(knex, tenantId, boardId)');
    // No second copy of the rule: the old family filter and the ITIL level-3 ordering are gone.
    expect(resolver).not.toContain('is_from_itil_standard');
    expect(resolver).not.toContain('itil_priority_level');

    expect(source('ee/packages/microsoft-teams/src/lib/teams/bot/teamsGuestIntake.ts')).toContain(
      'resolveDefaultPriorityIdForBoard(tenantId, defaults.boardId)'
    );
    expect(source('packages/integrations/src/actions/integrations/telephonyActions.ts')).toContain(
      'ee.resolveDefaultPriorityIdForBoard(tenant, defaults.boardId)'
    );
  });

  it('T141: the maintenance workflow action refuses a priority that does not fit the board', () => {
    const action = source('shared/workflow/runtime/actions/businessOperations/assetMaintenance.ts');
    const handler = action.slice(
      action.indexOf("id: 'assets.create_maintenance_ticket'"),
      action.indexOf("id: 'assets.complete_maintenance'")
    );
    expect(handler).toContain('findBoardFieldProblems(tx.trx, tx.tenantId, {');
    expect(handler).toContain('priorityId: input.priority_id');
    expect(handler).toContain("code: 'VALIDATION_ERROR'");
    // A refuse path (R6): it must not ask the funnel to repair the values.
    expect(handler).not.toContain('boardFieldPolicy');
  });

  it('T142, T143: the RMM alert creator falls back and never reads a project-task priority', () => {
    const creator = source('shared/rmm/alerts/ticketCreator.ts');
    expect(creator).toContain('resolveTicketPriorityFields(trx, tenantId, {');
    expect(creator).toContain("policy: 'fallback'");
    const lookup = creator.slice(creator.indexOf('async function resolvePriorityForSeverity('));
    expect(lookup).toContain("where({ item_type: 'ticket' })");
  });

  it('T144: the Huntress incident creator falls back and drops a category that is not the board’s', () => {
    const creator = source('ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts');
    expect(creator).toContain('prepareTicketCreateFields(trx, tenantId, {');
    expect(creator).toContain("policy: 'fallback'");
    expect(creator).toContain('priority_id: fields.priority_id');
    expect(creator).toContain('category_id: fields.category_id');
    expect(creator).toContain('subcategory_id: fields.subcategory_id');
  });

  it('T145–T149: every fall-back writer asks the funnel to repair, and every refuse writer does not', () => {
    const fallbackWriters: Array<[string, string]> = [
      // Inbound email (R6: an email never becomes nothing).
      ['shared/workflow/actions/emailWorkflowActions.ts', 'const result = await TicketModel.createTicketWithRetry({'],
      // Telephony auto-ticket.
      ['packages/telephony/src/services/autoTicketFromCall.ts', 'const created = await TicketModel.createTicketWithRetry('],
      // Inbound webhook create (D7).
      ['packages/tickets/src/actions/inboundActions.ts', 'const created = await TicketModel.createTicketWithRetry(input,'],
      // Service request provider.
      ['server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts', 'const ticket = await TicketModel.createTicketWithRetry('],
      // Data-migration import.
      ['server/src/lib/migrations/appliers/entityAppliers.ts', 'const created = await TicketModel.createTicket('],
      // Workflow tickets.create (D7) and the contract renewal ticket, through the side-effects service.
      ['shared/workflow/runtime/actions/businessOperations/tickets.ts', 'created = await createTicketWithSideEffects(tx.trx, tx.tenantId, {'],
      ['shared/billingClients/renewalTicket.ts', 'return createTicketWithSideEffects(trx, tenant, {'],
    ];
    for (const [file, anchor] of fallbackWriters) {
      expect(createCall(file, anchor), `${file} must create with the fall-back policy`).toContain(
        "boardFieldPolicy: 'fallback'"
      );
    }

    const refuseWriters: Array<[string, string]> = [
      // MSP create and the batch duplicate.
      ['packages/tickets/src/actions/ticketActions.ts', 'const ticketResult = await TicketModel.createTicketWithRetry('],
      ['packages/tickets/src/actions/ticketActions.ts', 'const createdTicket = await createTicketWithSideEffects(trx, tenant, {'],
      // Templates and recurring schedules.
      ['packages/tickets/src/lib/instantiateTicketTemplate.ts', 'await createTicketWithSideEffects(trx, tenant, {'],
      // Teams message action and guest intake.
      ['ee/packages/microsoft-teams/src/lib/teams/actions/teamsActionRegistry.ts', 'TicketModel.createTicketWithRetry('],
      ['ee/packages/microsoft-teams/src/lib/teams/bot/teamsGuestIntake.ts', 'return TicketModel.createTicketWithRetry('],
      // Manual telephony ticket.
      ['packages/integrations/src/actions/integrations/telephonyActions.ts', 'const created = await TicketModel.createTicketWithRetry('],
      // The maintenance workflow action.
      ['shared/workflow/runtime/actions/businessOperations/assetMaintenance.ts', 'const ticket = await createTicketWithSideEffects(tx.trx, tx.tenantId, {'],
      // REST v1 create.
      ['server/src/lib/api/services/TicketService.ts', 'const ticketResult = await TicketModel.createTicketWithRetry('],
    ];
    for (const [file, anchor] of refuseWriters) {
      expect(createCall(file, anchor), `${file} must keep the refusing default`).not.toContain(
        'boardFieldPolicy'
      );
    }
  });

  it('T150: the REST create answers a refused board field with 400 against that field', () => {
    const service = source('server/src/lib/api/services/TicketService.ts');
    expect(service).toContain('isBoardFieldRuleError');
    expect(service).toContain("from '@alga-psa/shared/lib/tickets/boardFieldRules'");
    const mapper = service.slice(
      service.indexOf('export function throwTicketModelCreateApiError('),
      service.indexOf('function applyDefaultContactPhoneJoin(')
    );
    expect(mapper).toContain('isBoardFieldRuleError(error)');
    expect(mapper).toContain("new ValidationError('Validation failed', [{ path: [error.field], message: error.message }])");
    // Create from asset routes through the same mapper, so it answers 400 too.
    expect(service).toContain('.catch(throwTicketModelCreateApiError)');
    expect(
      (service.match(/\.catch\(throwTicketModelCreateApiError\)/g) ?? []).length,
      'both REST create paths map model refusals'
    ).toBe(2);
  });

  it('T151: no create path writes a ticket row outside the funnel without the shared rule', () => {
    // The two documented raw inserts are the RMM and Huntress creators; both resolve their fields
    // through the shared module first. A third raw insert would mean a path with no rule at all.
    const roots = ['packages', 'server/src', 'shared', 'ee/server/src', 'ee/packages', 'services'];
    const skip = new Set(['node_modules', 'dist', '.next', 'build', '__snapshots__']);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          /\.(ts|tsx)$/.test(entry.name) &&
          !/\.(test|spec)\.tsx?$/.test(entry.name) &&
          // Test fixtures and harnesses seed rows directly; they are not creation paths.
          !/(^|\/)(test|tests|__tests__|e2e)(\/|$)/.test(path.relative(REPO_ROOT, full))
        ) {
          const text = fs.readFileSync(full, 'utf8');
          if (/table\('tickets'\)\s*\n?\s*\.insert\(/.test(text)) offenders.push(path.relative(REPO_ROOT, full));
        }
      }
    };
    for (const root of roots) {
      const full = path.resolve(REPO_ROOT, root);
      if (fs.existsSync(full)) walk(full);
    }

    expect(offenders.sort()).toEqual(
      [
        'ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts',
        'shared/models/ticketModel.ts',
        'shared/rmm/alerts/ticketCreator.ts',
        // Not a production write path: used by one integration test only (SCRATCHPAD code checks).
        'shared/services/emailService.ts',
      ].sort()
    );
  });
});
