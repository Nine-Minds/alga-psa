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

/**
 * Files that may name `priorities` or `categories` themselves, each with the reason it is not a
 * picker. The list is checked both ways: a file that is not here may not read the tables, and a
 * file here that no longer reads them is reported as stale, so the list cannot rot.
 */
const DISPLAY_JOIN = 'display join: labels a row that was already chosen; offers no list to choose from';
const LABEL_LOOKUP = 'reads one named row to label it; the choice itself was made through the rules';
const READ_ALLOW_LIST = new Map([
  // The rules themselves, and the seeding that creates the rows they describe.
  ['shared/lib/tickets/boardFieldRules.ts', 'the rules'],
  ['packages/tickets/src/services/itilStandardsService.ts', 'seeds the standard priorities and each ITIL board’s category set'],
  ['packages/tickets/src/services/boardLifecycle.ts', 'board create/update/delete: owns a board’s default priority and its category set'],
  ['packages/tickets/src/lib/ticketFieldReferences.ts', 'the client-side half of the rules, delegating to the shared module'],
  ['packages/reference-data/src/actions/referenceDataActions.ts', 'reference-data CRUD and import: owns these rows'],
  ['packages/reference-data/src/actions/priorityActions.ts', 'priority CRUD: owns these rows'],
  ['packages/sla/src/services/itilSlaService.ts', 'maps the ITIL priorities onto the standard SLA targets'],
  // Category CRUD and the REST surfaces over it: they own the rows, and their board checks go
  // through the shared module.
  ['server/src/lib/api/services/CategoryService.ts', 'category CRUD over REST: owns these rows'],
  ['packages/tickets/src/actions/ticketCategoryActions.ts', 'category CRUD on the web: owns these rows'],
  ['server/src/app/api/v1/tickets/categories/route.ts', 'REST category list: narrows by board through the shared rule'],
  ['server/src/app/api/v1/tickets/priorities/route.ts', 'REST priority list: narrows by board through the shared rule'],
  // Lookups and mappings that narrow by board through the shared rule's own helpers.
  ['server/src/lib/actions/inboundWebhookLookups.ts', 'webhook mapping lookups: narrowed by board through the shared rule'],
  ['packages/integrations/src/actions/email-actions/ticketFieldOptionsActions.ts', 'inbound-defaults options: narrowed by board through the shared rule'],
  ['packages/integrations/src/actions/integrations/rmmAlertRuleActions.ts', 'RMM alert-rule options: narrowed by board through the shared rule'],
  ['ee/server/src/lib/actions/integrations/huntressActions.ts', 'Huntress mapping options: narrowed by board through the shared rule'],
  // Co-managed holds its own SLA/priority mappings for the other organisation's rows.
  ['packages/co-managed/src/slaPriorityMappings.ts', 'maps the other organisation’s priorities onto the MSP’s'],
  ['packages/co-managed/src/ticketEditing.ts', 'co-managed edit: checks the pair through the shared rule, then labels it'],
  ['packages/co-managed/src/ticketSla.ts', `${LABEL_LOOKUP} (the mapped MSP priority of a shared ticket)`],
  // Writers that resolve their fields through the shared module and then write the row.
  ['shared/models/ticketModel.ts', 'the create/update funnel: resolves the fields through the rules first'],
  ['shared/rmm/alerts/ticketCreator.ts', 'alert writer: resolves its fields through the rules first'],
  ['shared/workflow/runtime/actions/businessOperations/assetMaintenance.ts', 'maintenance ticket: checks the pair through the rules first'],
  ['shared/workflow/runtime/actions/businessOperations/tickets.ts', 'workflow update: the row must exist before the model applies the rules'],
  // Not a production path (one integration test uses it); kept out of scope by the plan.
  ['shared/services/emailService.ts', 'not a production path (one integration test uses it); out of scope by the plan'],
  // Email routing resolves a stored default's row to publish it on the event.
  ['server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts', `${LABEL_LOOKUP} (the email payload’s priority and category names)`],
  // The data-migration tooling maps a source system's names onto the tenant's rows.
  ['server/src/lib/migrations/migrationActions.ts', 'data migration: maps a source system’s names onto the tenant’s rows'],
  ['server/src/lib/migrations/AmpExportService.ts', `${DISPLAY_JOIN} (an export of existing tickets)`],
  // Pickers and feeds that list across boards on purpose, through the shared rule or its R9 helper.
  ['packages/tickets/src/actions/optimizedTicketActions.ts', 'ticket feeds: categories through listCategoriesForBoard / standardCategoryFilterOptions, priorities filtered by the client helper'],
  ['packages/tickets/src/actions/ticketActions.ts', 'ticket feeds: display joins and the subcategory parent check beside prepareTicketFieldPatchOrThrow'],
  ['packages/documents/src/actions/kbArticleActions.ts', 'knowledge-base category picker: de-duplicated through the shared R9 helper'],
  ['packages/inventory/src/lib/ghostUsage.ts', 'ghost-usage review filter: de-duplicated through the shared R9 helper'],
  // Rows that are created by a wizard or an import, not offered as a choice on a ticket.
  ['packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts', 'onboarding wizard: seeds the tenant’s own priorities and categories'],
  ['packages/tickets/src/actions/ticketImportActions.ts', 'CSV import: creates the rows a column names, then resolves each row through the rules'],
  // Project-task priorities are a different family of rows (item_type 'project_task').
  ['packages/projects/src/actions/phaseTaskImportActions.ts', 'project-task priorities (item_type project_task), not a board’s ticket priorities'],
  ['packages/projects/src/actions/projectTaskExportActions.ts', 'project-task priorities (item_type project_task), not a board’s ticket priorities'],
  // One named row, read to label it or to price an SLA target.
  ['packages/sla/src/actions/slaActions.ts', `${LABEL_LOOKUP} (an SLA target’s priority)`],
  ['packages/user-activities/src/actions/activityStatusActions.ts', `${LABEL_LOOKUP}; the ticket write beside it goes through prepareTicketFieldPatch`],
  ['server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts', `${LABEL_LOOKUP} (the old and new priority names in a notification)`],
  // Display joins: a ticket row's priority or category name, read with the row.
  ['ee/packages/microsoft-teams/src/lib/teams/teamsPsaData.ts', DISPLAY_JOIN],
  ['ee/server/src/services/smartSearch/entities/project.ts', DISPLAY_JOIN],
  ['ee/server/src/services/smartSearch/entities/ticket.ts', DISPLAY_JOIN],
  ['packages/assets/src/actions/assetActions.ts', DISPLAY_JOIN],
  ['packages/client-portal/src/actions/client-portal-actions/client-project-details.ts', DISPLAY_JOIN],
  ['packages/client-portal/src/actions/client-portal-actions/client-tickets.ts', DISPLAY_JOIN],
  ['packages/clients/src/actions/clientPulseActions.ts', DISPLAY_JOIN],
  ['packages/clients/src/actions/contact-actions/contactBentoActions.ts', DISPLAY_JOIN],
  ['packages/co-managed/src/sharedTicketDetails.ts', DISPLAY_JOIN],
  ['packages/co-managed/src/sharedWorkRead.ts', DISPLAY_JOIN],
  ['packages/co-managed/src/ticketQueue.ts', DISPLAY_JOIN],
  ['packages/ee/src/services/documentAssistContextService.ts', DISPLAY_JOIN],
  ['packages/reporting/src/actions/helpdeskReportActions.ts', DISPLAY_JOIN],
  ['packages/scheduling/src/actions/ticketLookupActions.ts', DISPLAY_JOIN],
  ['packages/sla/src/actions/slaReportingActions.ts', DISPLAY_JOIN],
  ['packages/sla/src/services/escalationService.ts', DISPLAY_JOIN],
  ['packages/sla/src/services/slaNotificationService.ts', DISPLAY_JOIN],
  ['packages/tickets/src/lib/labelViewModelProvider.ts', DISPLAY_JOIN],
  ['packages/tickets/src/models/ticket.ts', DISPLAY_JOIN],
  ['packages/user-activities/src/actions/activityAggregationActions.ts', DISPLAY_JOIN],
  ['server/src/lib/api/services/ProjectService.ts', DISPLAY_JOIN],
  ['server/src/lib/api/services/TicketService.ts', `${DISPLAY_JOIN}; its writes go through prepareTicketFieldPatch`],
  ['server/src/lib/eventBus/subscribers/slaNotificationSubscriber.ts', DISPLAY_JOIN],
  ['server/src/lib/eventBus/subscribers/webhook/webhookProjectPayload.ts', DISPLAY_JOIN],
  ['server/src/lib/eventBus/subscribers/webhook/webhookTicketPayload.ts', DISPLAY_JOIN],
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

// A table is named through `.table('x')`, `from('x')` or a helper whose name ends in `table`
// (`tenantScopedTable(trx, 'tickets', tenant)`), so the table literal may follow earlier
// arguments. Matching the helper shape too keeps a writer from hiding behind one.
const TABLE_CALL = String.raw`\b[\w.]*(?:table|from)\s*\(\s*(?:[^()'"]*,\s*)?`;
const TICKETS_TABLE_PATTERN = new RegExp(`${TABLE_CALL}['"]tickets(?:\\s+as\\s+\\w+)?['"]`, 'gi');

// A read is found by the table name, not by the call syntax: the literal may be any argument of the
// call (`tenantScopedTable(trx, 'categories', tenant)`), carry an alias (`'priorities as p'`), sit
// on its own line, or be handed to a join (`db.tenantJoin(query, 'categories as cat', …)`) or to a
// callable connection (`trx('categories')`). What makes it a table reference is the callee: a
// query-builder method that takes a table, a helper whose name ends in `table`/`join`, or the
// connection itself. A string compared to a value (`dataType === 'categories'`) has no callee and
// is not a read.
const TABLE_NAME_LITERAL = /['"](priorities|categories)(?:\s+as\s+\w+)?['"]/g;
const TABLE_METHODS = [
  'table',
  'from',
  'into',
  'join',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'crossJoin',
  'outerJoin',
  'fullOuterJoin',
  'leftOuterJoin',
  'rightOuterJoin',
  'tenantJoin',
  'withSchema',
];
const TABLE_CALLEE = new RegExp(`(?:^|\\.)(?:${TABLE_METHODS.join('|')})$|(?:table|join)$`, 'i');
const CONNECTION_CALLEE = /(?:^|\.)(?:knex|trx|tx|db|conn|connection|dbConnection|scopedDb|dbInstance)$/i;
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
 * The callee of the call that encloses `index`, or null when the position is not a call argument:
 * walk back over balanced brackets to the enclosing `(`, then read the identifier chain before it.
 */
function enclosingCallee(source, index) {
  let depth = 0;
  let at = index - 1;
  for (; at >= 0; at -= 1) {
    const char = source[at];
    if (char === ')' || char === ']' || char === '}') depth += 1;
    else if (char === '(' || char === '[' || char === '{') {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  if (at < 0 || source[at] !== '(') return null;
  let end = at;
  while (end > 0 && /\s/.test(source[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && /[\w$.?\]]/.test(source[start - 1])) start -= 1;
  const callee = source.slice(start, end);
  return callee.length > 0 ? callee : null;
}

/** Every read of `priorities` or `categories`, whatever call shape names the table. */
function findTableReads(source) {
  const reads = [];
  for (const match of source.matchAll(TABLE_NAME_LITERAL)) {
    const callee = enclosingCallee(source, match.index);
    if (!callee) continue;
    if (!TABLE_CALLEE.test(callee) && !CONNECTION_CALLEE.test(callee)) continue;
    reads.push({ line: lineOf(source, match.index), table: match[1] });
  }
  return reads;
}

/**
 * A write is "direct" when an update/insert on `tickets` names one of the board-owned columns.
 *
 * Only an object literal is read, and only as far as its own closing brace, so a later statement
 * cannot be mistaken for this one's payload — `.update(slaUpdateData)` followed by an event log
 * that carries `priority_id` is not a ticket field write. A payload built elsewhere and passed by
 * name is not a shape this guard can judge; the contract test (F136) covers those writers.
 */
function findDirectTicketWrites(source) {
  const findings = [];
  for (const match of source.matchAll(TICKETS_TABLE_PATTERN)) {
    const window = source.slice(match.index + match[0].length, match.index + 900);
    const callAt = window.search(WRITE_CALL_PATTERN);
    if (callAt === -1) continue;
    const payload = objectLiteralAfter(window.slice(callAt));
    if (!payload) continue;
    const field = BOARD_FIELD_PATTERN.exec(payload);
    if (field) findings.push({ line: lineOf(source, match.index), field: field[1] });
  }
  return findings;
}

/** The `{ ... }` an `.update(`/`.insert(` opens with, up to its matching brace; null for anything else. */
function objectLiteralAfter(text) {
  const open = text.indexOf('{');
  if (open === -1 || /[^\s(]/.test(text.slice(text.indexOf('(') + 1, open))) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

const violations = [];
const allowedFilesSeen = new Set();
const staleCandidates = new Set();
const scannedRoots = SCAN_ROOTS.map((dir) => join(ROOT, dir)).filter(
  (dir) => existsSync(dir) && statSync(dir).isDirectory()
);

for (const dir of scannedRoots) {
  for (const file of collectSourceFiles(dir)) {
    const rel = relative(ROOT, file).split('\\').join('/');
    // Test fixtures and harnesses seed rows; they are not product paths.
    if (/(^|\/)(test|tests|__tests__|e2e|test-utils)(\/|$)/.test(rel)) continue;
    const source = readFileSync(file, 'utf8');

    const reads = findTableReads(source);
    if (READ_ALLOW_LIST.has(rel)) {
      // A file present in the tree with no read left is a stale entry (reported below); a file the
      // scanned tree does not hold at all is simply not this run's business (fixture trees).
      if (reads.length > 0) allowedFilesSeen.add(rel);
      else staleCandidates.add(rel);
    } else {
      for (const read of reads) {
        violations.push(
          `${rel}:${read.line} reads \`${read.table}\` directly — list through shared/lib/tickets/boardFieldRules.ts`
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

for (const rel of staleCandidates) {
  if (allowedFilesSeen.has(rel)) continue;
  violations.push(
    `${rel} is on the read allow-list but no longer reads \`priorities\` or \`categories\` — delete the entry`
  );
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
