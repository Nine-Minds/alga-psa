/**
 * T122, T129, T131, T133 — F061–F068 of `ee/plans/2026-11-21-itil-remediation` (`impact-urgency`).
 *
 * The wiring half of the group: every writer the PRD names resolves the priority, Impact and
 * Urgency through the shared rule rather than its own copy, no `P{n} -` name lookup is left
 * anywhere, the level is not accepted from a client, and the screens show "Not assessed". The
 * behaviour itself is in `src/test/integration/itilImpactUrgency.integration.test.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const LOCALES_DIR = path.resolve(REPO_ROOT, 'server/public/locales');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

/** Every tracked source file of the packages this plan touches, for the repo-wide scans. */
function trackedSources(): string[] {
  const roots = ['packages', 'server/src', 'shared', 'ee/server/src', 'ee/packages'];
  const files: string[] = [];
  const skip = new Set(['node_modules', 'dist', '.next', 'build', '__snapshots__']);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|cjs|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  for (const root of roots) {
    const full = path.resolve(REPO_ROOT, root);
    if (fs.existsSync(full)) walk(full);
  }
  return files;
}

describe('ITIL Impact × Urgency wiring', () => {
  it('T122: no source file looks an ITIL priority up by its P-number name', () => {
    // The removed shape: `P${level} -%` fed to `where('priority_name', 'like', …)`. Scanning for
    // the pattern itself (not just the four known sites) is what keeps a new copy out.
    const offenders = trackedSources().filter((file) => {
      if (file === __filename) return false; // this file names the pattern it bans
      const text = fs.readFileSync(file, 'utf8');
      return /P\$\{[^}]*\}\s*-%/.test(text) || /priority_name['"]?,\s*['"]like['"]/.test(text);
    });

    expect(offenders.map((file) => path.relative(REPO_ROOT, file)), 'P-number priority lookups').toEqual([]);
  });

  it('T122: the four former lookup sites now call the shared rule', () => {
    const sites: Array<[string, string]> = [
      ['packages/tickets/src/actions/ticketActions.ts', 'resolveTicketPriorityFieldsOrThrow'],
      ['packages/tickets/src/actions/ticketActions.ts', 'resolveTicketPriorityPatch'],
      ['packages/tickets/src/actions/optimizedTicketActions.ts', 'resolveTicketPriorityPatch'],
      [
        'server/src/lib/service-requests/providers/builtins/ticketOnlyExecutionProvider.ts',
        'resolveTicketPriorityFields',
      ],
      ['packages/tickets/src/lib/instantiateTicketTemplate.ts', 'resolveTicketPriorityFieldsOrThrow'],
    ];

    for (const [file, symbol] of sites) {
      expect(source(file), `${file} must resolve priority fields through ${symbol}`).toContain(symbol);
    }
  });

  it('T122: the shared rule is the only implementation of the matrix lookup', () => {
    // `resolveItilPriorityId` reads `itil_priority_level` (D8); nothing else may query the ITIL
    // priority for an Impact × Urgency pair.
    expect(source('shared/lib/tickets/boardFieldRules.ts')).toContain('itil_priority_level: level');

    const matrixCallers = trackedSources().filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return /calculateItilPriority\s*\(/.test(text);
    }).map((file) => path.relative(REPO_ROOT, file));

    // Server-side: the shared module only. The client components compute the badge for display and
    // the matrix module itself defines it; tests may exercise it.
    const serverCallers = matrixCallers.filter(
      (file) => !file.endsWith('.tsx') && !/\.test\.|priorityMatrix|itilUtils/.test(file)
    );
    expect(serverCallers).toEqual(['shared/lib/tickets/boardFieldRules.ts']);
  });

  it('T129: itil_priority_level is not accepted by a ticket create or update schema', () => {
    const ticketSchemas = source('packages/tickets/src/schemas/ticket.schema.ts');
    // The create payload no longer declares it at all…
    expect(ticketSchemas).not.toContain('itil_priority_level: z.number().int().min(1).max(5).optional()');
    // …and the update schema omits the column the row shape still carries for reads.
    expect(ticketSchemas).toMatch(/ticketUpdateSchema[\s\S]*?itil_priority_level: true,[\s\S]*?\}\);/);
    expect(source('shared/models/ticketModel.ts')).toMatch(
      /ticketUpdateSchema[\s\S]*?itil_priority_level: true,[\s\S]*?\}\);/
    );
  });

  it('T129: the ticket list reads the level from the joined priority row', () => {
    expect(source('packages/tickets/src/actions/optimizedTicketActions.ts')).toContain(
      "'p.itil_priority_level as itil_priority_level'"
    );
    expect(source('packages/tickets/src/actions/ticketActions.ts')).toContain(
      "'p.itil_priority_level as priority_itil_level'"
    );
  });

  it('T129: the SLA stage events take the level from the ticket’s priority', () => {
    for (const file of [
      'packages/tickets/src/actions/ticketActions.ts',
      'packages/tickets/src/actions/optimizedTicketActions.ts',
    ]) {
      const text = source(file);
      expect(text).toContain('itilPriorityLevel: await itilPriorityLevelForPriority(');
      expect(text).not.toContain('itilPriorityLevel: fullTicket.itil_priority_level');
      expect(text).not.toContain('itilPriorityLevel: currentTicket.itil_priority_level');
    }
  });

  it('T131: the ticket screens show the stored priority and "Not assessed"', () => {
    // Ticket detail: the ITIL layout renders the priority it holds whenever the pair is missing.
    const info = source('packages/tickets/src/components/ticket/TicketInfo.tsx');
    expect(info).toContain('id="ticket-itil-not-assessed"');
    expect(info).toContain("t('itil.notAssessed', 'Not assessed')");
    expect(info).toContain('storedPriorityOption');

    // The hero is where the priority is changed, so it says the pair is gone (D5).
    const hero = source('packages/tickets/src/components/ticket/bento/BentoHero.tsx');
    expect(hero).toContain('itilAssessmentMissing');
    expect(hero).toContain("t('itil.notAssessed', 'Not assessed')");
    expect(hero).toContain('-itil-not-assessed');

    // Quick add: a prefill may carry an ITIL priority with no assessment, and that is a valid
    // ticket, so the pair is not demanded and the priority is shown.
    const quickAdd = source('packages/tickets/src/components/QuickAddTicket.tsx');
    expect(quickAdd).toContain('id="quick-add-itil-not-assessed"');
    expect(quickAdd).toContain('needsItilAssessment');
    expect(quickAdd).toContain("t('itil.notAssessed', 'Not assessed')");
  });

  it('T133: every new Impact/Urgency key exists in every locale', () => {
    const locales = fs
      .readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(locales).toContain('en');
    expect(locales.length).toBeGreaterThanOrEqual(10);

    for (const locale of locales) {
      const bundle = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, locale, 'features/tickets.json'), 'utf8')
      );
      expect(typeof bundle.itil?.notAssessed, `${locale}: itil.notAssessed`).toBe('string');
      expect(typeof bundle.itil?.priorityLabel, `${locale}: itil.priorityLabel`).toBe('string');
      expect(
        typeof bundle.errors?.ticket?.impactUrgencyTogether,
        `${locale}: errors.ticket.impactUrgencyTogether`
      ).toBe('string');
      expect(
        bundle.errors?.ticket?.itilPriorityMissingForAssessment,
        `${locale}: errors.ticket.itilPriorityMissingForAssessment`
      ).toContain('{{board}}');
    }
  });

  it('T133: the refusals the server composes carry those keys', () => {
    const rules = source('shared/lib/tickets/boardFieldRules.ts');
    expect(rules).toContain("messageKey: 'features/tickets:errors.ticket.impactUrgencyTogether'");
    expect(rules).toContain(
      "messageKey: 'features/tickets:errors.ticket.itilPriorityMissingForAssessment'"
    );
    // The thrown error is the channel that reaches the user as a field error, not a redacted 500.
    expect(source('packages/tickets/src/actions/ticketActionErrors.ts')).toContain(
      'error instanceof TicketBoardFieldError'
    );
  });
});
