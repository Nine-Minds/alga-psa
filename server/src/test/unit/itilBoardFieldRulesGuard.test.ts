/**
 * T233–T235 — F135, F136 of `ee/plans/2026-11-21-itil-remediation` (`guard`).
 *
 * The guard is what keeps the rules applied after this plan: a new picker that queries
 * `priorities` or `categories` itself, or a new writer that sets a ticket's priority, category or
 * board directly, fails the build. The contract half names the writers the PRD lists and requires
 * each of them to reach the shared rules.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const GUARD = path.join(REPO_ROOT, 'scripts/guard-ticket-board-field-rules.mjs');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [GUARD, '--root', root], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

/** A throwaway tree with one file, scanned as if it were the repository. */
function fixtureTree(relativePath: string, contents: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alga-board-field-guard-'));
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return root;
}

describe('ticket board field rules guard', () => {
  it('T233: passes on the repository', () => {
    const result = runGuard(REPO_ROOT);
    expect(result.output).toContain('[ticket-board-field-rules] OK');
    expect(result.status).toBe(0);
  }, 120_000);

  it('T234: fails on a picker that queries categories by board itself', () => {
    const root = fixtureTree(
      'packages/tickets/src/actions/newCategoryPicker.ts',
      `import { tenantDb } from '@alga-psa/db';

export async function listCategoriesForTheForm(trx: unknown, tenant: string, boardId: string) {
  return tenantDb(trx as never, tenant)
    .table('categories')
    .where({ board_id: boardId })
    .select('*');
}
`
    );
    try {
      const result = runGuard(root);
      expect(result.status).toBe(1);
      expect(result.output).toContain('reads `categories` directly');
      expect(result.output).toContain('newCategoryPicker.ts');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('T234: fails on a writer that updates a ticket’s priority directly', () => {
    const root = fixtureTree(
      'packages/tickets/src/actions/quickPriorityWrite.ts',
      `import { tenantDb } from '@alga-psa/db';

export async function setPriority(trx: unknown, tenant: string, ticketId: string, priorityId: string) {
  await tenantDb(trx as never, tenant)
    .table('tickets')
    .where({ ticket_id: ticketId })
    .update({ priority_id: priorityId });
}
`
    );
    try {
      const result = runGuard(root);
      expect(result.status).toBe(1);
      expect(result.output).toContain('writes `tickets.priority_id` directly');
      expect(result.output).toContain('quickPriorityWrite.ts');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('T234: fails on a writer that reaches the table through a helper', () => {
    // `tenantScopedTable(trx, 'tickets', tenant)` names the table through a helper, not
    // `.table('tickets')`; the guard reads the helper shape too, so a writer cannot hide there.
    const root = fixtureTree(
      'packages/tickets/src/actions/helperPriorityWrite.ts',
      `import { tenantScopedTable } from '@alga-psa/db';

export async function setPriority(trx: unknown, tenant: string, ticketId: string, priorityId: string) {
  await tenantScopedTable(trx as never, 'tickets', tenant)
    .where({ ticket_id: ticketId })
    .update({ priority_id: priorityId });
}
`
    );
    try {
      const result = runGuard(root);
      expect(result.status).toBe(1);
      expect(result.output).toContain('writes `tickets.priority_id` directly');
      expect(result.output).toContain('helperPriorityWrite.ts');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('T234: an update whose payload is built elsewhere is not a ticket field write', () => {
    // The payload is a variable, so the guard cannot read it; a nearby `priority_id` in an
    // unrelated call must not be mistaken for this update's. F136 covers those writers instead.
    const root = fixtureTree(
      'packages/sla/src/services/slaWrite.ts',
      `import { tenantScopedTable } from '@alga-psa/db';

export async function stampSla(trx: unknown, tenant: string, ticketId: string, priorityId: string) {
  const slaUpdateData: Record<string, unknown> = { sla_started_at: new Date() };
  await tenantScopedTable(trx as never, tenant, 'tickets')
    .where({ ticket_id: ticketId })
    .update(slaUpdateData);
  await logSlaEvent(trx, tenant, ticketId, 'sla_started', { priority_id: priorityId });
}

declare function logSlaEvent(...args: unknown[]): Promise<void>;
`
    );
    try {
      expect(runGuard(root).status).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('T234: a file on the allow-list is not a violation', () => {
    // The same two shapes, in a file the guard names: the rules themselves may read the rows.
    const root = fixtureTree(
      'shared/lib/tickets/boardFieldRules.ts',
      `export async function listPrioritiesForBoard(conn: any, tenant: string) {
  return conn.table('priorities').where({ item_type: 'ticket' });
}
`
    );
    try {
      expect(runGuard(root).status).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('T235: every writer the PRD names reaches the shared rules', () => {
    // The writers of the PRD's refuse/fall-back table, and what each of them has to import or
    // call. A writer that stops reaching the rules fails here before the guard sees it.
    const writers: Array<[file: string, needle: string]> = [
      // Creates: all of them funnel through the model, which applies the rules itself.
      ['shared/models/ticketModel.ts', 'prepareTicketCreateFields'],
      ['packages/client-portal/src/actions/client-portal-actions/client-tickets.ts', 'isBoardFieldRuleError'],
      ['packages/tickets/src/actions/ticketImportActions.ts', 'prepareTicketCreateFields'],
      ['ee/packages/microsoft-teams/src/lib/teams/actions/teamsActionRegistry.ts', 'defaultPriorityForBoard'],
      ['shared/workflow/runtime/actions/businessOperations/assetMaintenance.ts', 'findBoardFieldProblems'],
      ['shared/rmm/alerts/ticketCreator.ts', 'resolveTicketPriorityFields'],
      ['ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts', 'prepareTicketCreateFields'],
      ['packages/telephony/src/services/autoTicketFromCall.ts', "boardFieldPolicy: 'fallback'"],
      ['shared/billingClients/renewalTicket.ts', "boardFieldPolicy: 'fallback'"],
      ['shared/workflow/runtime/actions/businessOperations/tickets.ts', "boardFieldPolicy: 'fallback'"],
      ['packages/tickets/src/actions/inboundActions.ts', "boardFieldPolicy: 'fallback'"],
      ['server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts', 'resolveTicketPriorityFields'],
      ['server/src/lib/migrations/appliers/entityAppliers.ts', "boardFieldPolicy: 'fallback'"],
      ['shared/workflow/actions/emailWorkflowActions.ts', 'resolveTicketPriorityFields'],
      // Updates.
      ['packages/tickets/src/actions/ticketActions.ts', 'prepareTicketFieldPatchOrThrow'],
      ['packages/tickets/src/actions/optimizedTicketActions.ts', 'prepareTicketFieldPatchOrThrow'],
      ['server/src/lib/api/services/TicketService.ts', 'prepareTicketFieldPatch'],
      ['packages/user-activities/src/actions/activityStatusActions.ts', 'prepareTicketFieldPatch'],
      ['packages/tickets/src/actions/ticketBundleUtils.ts', 'findBoardFieldProblems'],
      ['packages/co-managed/src/ticketEditing.ts', 'findBoardFieldProblems'],
      // Board lifecycle: the rules decide a board's default priority and its kind.
      ['packages/tickets/src/services/boardLifecycle.ts', 'defaultPriorityForBoardRow'],
    ];

    for (const [file, needle] of writers) {
      expect(source(file), `${file} must reach the shared rules (${needle})`).toContain(needle);
    }
  });
});
