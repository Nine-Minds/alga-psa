/**
 * T156–T170 (wiring) — F082–F091 of `ee/plans/2026-11-21-itil-remediation` (`writers-update`).
 *
 * The wiring half of the group: every update path resolves its board-owned fields through the one
 * shared patch rule, no site keeps a copy of the rule, and the two bundle write sites drop the
 * master's priority exactly for the children whose board uses the other family. The behaviour is
 * in `src/test/integration/itilUpdateWriters.integration.test.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('ITIL update writers wiring', () => {
  it('T156: both MSP update functions call the shared patch rule', () => {
    expect(source('packages/tickets/src/actions/ticketActions.ts')).toContain(
      "await prepareTicketFieldPatchOrThrow(trx, tenant, currentTicket, updateData, 'refuse')"
    );
    expect(source('packages/tickets/src/actions/optimizedTicketActions.ts')).toContain(
      "await prepareTicketFieldPatchOrThrow(trx, tenant, currentTicket, updateData, 'refuse')"
    );
  });

  it('T157: the REST update reports every problem the rule returns, against its own field', () => {
    const service = source('server/src/lib/api/services/TicketService.ts');
    const update = service.slice(service.indexOf('const fieldProblems = await prepareTicketFieldPatch('));
    expect(update.slice(0, 900)).toContain(
      'fieldProblems.map((problem) => ({ path: [problem.field], message: problem.message }))'
    );
    // The priority-only check it replaced is gone, so the subcategory is covered too.
    expect(service).not.toContain('findTicketUpdatePriorityBoardTypeProblem');
  });

  it('T159, T160: TicketModel.updateTicket applies the rule before it writes', () => {
    const model = source('shared/models/ticketModel.ts');
    expect(model).toContain('const patchProblems = await prepareTicketFieldPatch(');
    expect(model).toContain("validationOptions.boardFieldPolicy ?? 'refuse'");
    expect(model.indexOf('const patchProblems = await prepareTicketFieldPatch(')).toBeLessThan(
      model.indexOf("await db.table('tickets')\n      .where({ ticket_id: ticketId })\n      .update({")
    );
  });

  it('T161: both Activities priority writes resolve the write through the rule', () => {
    const actions = source('packages/user-activities/src/actions/activityStatusActions.ts');
    expect(actions).toContain("import { prepareTicketFieldPatch } from '@alga-psa/shared/lib/tickets/boardFieldRules'");
    expect(actions).toContain('async function resolveTicketPriorityWrite(');
    // Two writes, two calls, and neither writes `priority_id` on its own any more.
    expect(
      (actions.match(/\.\.\.\(await resolveTicketPriorityWrite\(trx, tenant, activityId, /g) ?? []).length
    ).toBe(2);
    // Each call sits inside a `tickets` UPDATE, and neither of those updates names the column.
    for (const match of actions.matchAll(/\.\.\.\(await resolveTicketPriorityWrite\(trx, tenant, activityId, /g)) {
      const before = actions.slice(Math.max(0, match.index! - 200), match.index!);
      expect(before).toContain('tenantScopedTable("tickets")');
      expect(before).not.toContain('priority_id:');
    }
  });

  it('T162: both bundle write sites drop the master’s priority for the children that refuse it', () => {
    const utils = source('packages/tickets/src/actions/ticketBundleUtils.ts');
    expect(utils).toContain("import { findBoardFieldProblems } from '@alga-psa/shared/lib/tickets/boardFieldRules'");
    expect(utils).toContain('async function childIdsRefusingPriority(');
    const calls = [...utils.matchAll(/childIdsRefusingPriority\(/g)].map((match) => match.index!);
    // The declaration plus one call per write site.
    expect(calls).toHaveLength(3);

    const propagate = utils.slice(utils.indexOf('export async function propagateBundleMasterStatus'));
    // Legacy mirror: the per-child field set drops the priority, and children are written in groups.
    expect(propagate).toContain("if (priorityRefusedBy.has(child.ticket_id as string)) delete fields.priority_id;");
    expect(propagate).toContain('for (const group of writeGroups.values())');
    // Boundary propagation: the refusing children are written without the priority.
    expect(propagate).toContain('const propagateWithoutPriority = { ...propagate };');
    expect(propagate).toContain('delete propagateWithoutPriority.priority_id;');
    expect(propagate).toContain('propagateForChild(child.ticket_id)');
  });

  it('T164: the bulk board move reports a refused ticket instead of counting it as moved', () => {
    const actions = source('packages/tickets/src/actions/ticketActions.ts');
    const move = actions.slice(actions.indexOf('export const moveTicketsToBoard'));
    expect(move).toContain('const result = await updateTicketWithCache(ticketId, updateData, options);');
    expect(move).toContain('if (isTicketActionError(result)) {');
    // The move no longer clears the category itself: the rule keeps it between two ITIL boards.
    expect(move.slice(0, 2_600)).not.toContain('updateData.category_id = null');
  });

  it('T165, T166: the board-move rules live in the shared patch rule, not at the call sites', () => {
    const rules = source('shared/lib/tickets/boardFieldRules.ts');
    const patch = rules.slice(rules.indexOf('export async function prepareTicketFieldPatch<'));
    const body = patch.slice(0, patch.indexOf('\n}\n'));
    // The category half translates first (R2), then checks, then clears what cannot be translated.
    expect(body.indexOf('translateStandardCategoryPairForBoard')).toBeGreaterThan(-1);
    expect(body.indexOf('translateStandardCategoryPairForBoard')).toBeLessThan(body.indexOf('findBoardFieldProblems'));
    expect(body).toContain("if (!keep && categoryTouched && policy === 'refuse') {");
    expect(body).toContain('const nextCategoryId = keep ? translated.categoryId : null;');
  });

  it('T167, T168: only what the patch touches is checked (R5)', () => {
    const rules = source('shared/lib/tickets/boardFieldRules.ts');
    const patch = rules.slice(rules.indexOf('export async function prepareTicketFieldPatch<'));
    expect(patch).toContain('if (!boardChanged && !priorityTouched && !categoryTouched) return [];');
    // "Touches" means changes: a patch that re-sends the stored value is not a change.
    expect(patch).toContain("key in patch && patch[key] !== undefined && !same(patch[key], current[key])");
  });
});
