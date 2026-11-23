#!/usr/bin/env node

/**
 * One set of rules for the board-owned ticket fields — `ee/plans/2026-11-21-itil-remediation`
 * (F135). The rules live in `shared/lib/tickets/boardFieldRules.ts`; this guard keeps new code
 * from going around them.
 *
 * It fails on two things, outside an allow-list:
 *
 *   1. a direct query of `priorities` or `categories` — the list a picker offers comes from
 *      `listPrioritiesForBoard` / `listCategoriesForBoard`, so a board never offers a value the
 *      server then refuses (R2, R3);
 *   2. a direct write of a ticket's `priority_id`, `category_id`, `subcategory_id` or `board_id` —
 *      every create goes through `TicketModel.createTicket` and every update through
 *      `prepareTicketFieldPatch`, which is where Impact × Urgency, the family check and the
 *      standard-category translation happen (R4, R5, R6).
 *
 * The allow-list is the set of files that *are* the rules, the seeding they need, and the two
 * writers that insert a ticket row directly (they resolve their fields through the shared module
 * first). Adding a file to it is a deliberate act, reviewed with the diff.
 *
 * Usage:
 *   node scripts/guard-ticket-board-field-rules.mjs
 *   node scripts/guard-ticket-board-field-rules.mjs --root /tmp/fixture   # scan another tree
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(getFlag('--root') ?? process.cwd());
const SCAN_ROOTS = ['packages', 'server/src', 'shared', 'ee/server/src', 'ee/packages', 'services'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'build', '__snapshots__', 'coverage']);

/** Files that may read `priorities` or `categories` directly. */
const READ_ALLOW_LIST = new Set([
  // The rules themselves, and the seeding that creates the rows they describe.
  'shared/lib/tickets/boardFieldRules.ts',
  'packages/tickets/src/services/itilStandardsService.ts',
  'packages/tickets/src/services/boardLifecycle.ts',
  'packages/tickets/src/lib/ticketFieldReferences.ts',
  'packages/reference-data/src/actions/referenceDataActions.ts',
  'packages/sla/src/services/itilSlaService.ts',
  // Category CRUD and the REST surfaces over it: they own the rows, and their board checks go
  // through the shared module.
  'server/src/lib/api/services/CategoryService.ts',
  'server/src/app/api/v1/tickets/categories/route.ts',
  'server/src/app/api/v1/tickets/priorities/route.ts',
  // Lookups and mappings that narrow by board through the shared rule's own helpers.
  'server/src/lib/actions/inboundWebhookLookups.ts',
  'packages/integrations/src/actions/email-actions/ticketFieldOptionsActions.ts',
  'packages/integrations/src/actions/integrations/rmmAlertRuleActions.ts',
  'ee/server/src/lib/actions/integrations/huntressActions.ts',
  // Co-managed holds its own SLA/priority mappings for the other organisation's rows.
  'packages/co-managed/src/slaPriorityMappings.ts',
  'packages/co-managed/src/ticketEditing.ts',
  'packages/co-managed/src/ticketSla.ts',
  // Writers that resolve their fields through the shared module and then write the row.
  'shared/models/ticketModel.ts',
  'shared/rmm/alerts/ticketCreator.ts',
  'shared/workflow/runtime/actions/businessOperations/assetMaintenance.ts',
  // Not a production path (one integration test uses it); kept out of scope by the plan.
  'shared/services/emailService.ts',
  // Email routing resolves a stored default's row to publish it on the event.
  'server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts',
  // The data-migration tooling maps a source system's names onto the tenant's rows.
  'server/src/lib/migrations/migrationActions.ts',
]);

/** Files that may write a ticket's board-owned fields directly. */
const WRITE_ALLOW_LIST = new Set([
  // The create funnel itself.
  'shared/models/ticketModel.ts',
  // The two alert writers that insert their ticket row directly; both resolve the fields first.
  'shared/rmm/alerts/ticketCreator.ts',
  'ee/server/src/lib/integrations/huntress/incidents/ticketCreator.ts',
  // Not a production path (see above).
  'shared/services/emailService.ts',
]);

const READ_PATTERN = /(?:\.table|\.from|\btable|\bfrom)\(\s*['"](priorities|categories)(?:\s+as\s+\w+)?['"]/g;
const TICKETS_TABLE_PATTERN = /(?:\.table|\btable|\bfrom)\(\s*['"]tickets(?:\s+as\s+\w+)?['"]\s*\)/g;
const BOARD_FIELD_PATTERN = /\b(priority_id|category_id|subcategory_id|board_id)\b\s*:/;
const WRITE_CALL_PATTERN = /\.(update|insert)\(/;

function getFlag(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

function collectSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(abs));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec|contract\.test)\.tsx?$/.test(entry.name)) {
      files.push(abs);
    }
  }
  return files;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * A write is "direct" when an update/insert on `tickets` names one of the board-owned columns.
 *
 * The payload read stops at the next `table(` call, so a later statement on another table cannot
 * be mistaken for this one's — `.update({ sla_policy_id: null })` on tickets followed by an
 * unrelated `priorities` sweep is not a ticket field write.
 */
function findDirectTicketWrites(source) {
  const findings = [];
  for (const match of source.matchAll(TICKETS_TABLE_PATTERN)) {
    const window = source.slice(match.index + match[0].length, match.index + 900);
    if (!WRITE_CALL_PATTERN.test(window)) continue;
    let payload = window.slice(window.search(WRITE_CALL_PATTERN));
    const nextTable = payload.search(/(?:\.table|\btable|\bfrom)\(\s*['"]/);
    if (nextTable > 0) payload = payload.slice(0, nextTable);
    const field = BOARD_FIELD_PATTERN.exec(payload.slice(0, 500));
    if (field) findings.push({ line: lineOf(source, match.index), field: field[1] });
  }
  return findings;
}

const violations = [];
const scannedRoots = SCAN_ROOTS.map((dir) => join(ROOT, dir)).filter(
  (dir) => existsSync(dir) && statSync(dir).isDirectory()
);

for (const dir of scannedRoots) {
  for (const file of collectSourceFiles(dir)) {
    const rel = relative(ROOT, file).split('\\').join('/');
    // Test fixtures and harnesses seed rows; they are not product paths.
    if (/(^|\/)(test|tests|__tests__|e2e)(\/|$)/.test(rel)) continue;
    const source = readFileSync(file, 'utf8');

    if (!READ_ALLOW_LIST.has(rel)) {
      for (const match of source.matchAll(READ_PATTERN)) {
        violations.push(
          `${rel}:${lineOf(source, match.index)} reads \`${match[1]}\` directly — list through shared/lib/tickets/boardFieldRules.ts`
        );
      }
    }

    if (!WRITE_ALLOW_LIST.has(rel)) {
      for (const finding of findDirectTicketWrites(source)) {
        violations.push(
          `${rel}:${finding.line} writes \`tickets.${finding.field}\` directly — go through TicketModel.createTicket or prepareTicketFieldPatch`
        );
      }
    }
  }
}

if (scannedRoots.length === 0) {
  console.error(`[ticket-board-field-rules] Nothing to scan under ${ROOT}`);
  process.exit(1);
}

if (violations.length > 0) {
  console.error('[ticket-board-field-rules] Board field rules bypassed:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  console.error(
    '\nThe rules live in shared/lib/tickets/boardFieldRules.ts. If a file genuinely owns these rows,'
  );
  console.error('add it to the allow-list in scripts/guard-ticket-board-field-rules.mjs, with the diff.');
  process.exit(1);
}

console.log('[ticket-board-field-rules] OK: every priority and category list, and every ticket field write, goes through the shared rules.');
