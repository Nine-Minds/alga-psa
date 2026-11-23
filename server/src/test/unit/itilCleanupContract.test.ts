/**
 * T228–T232 — F130–F134 of `ee/plans/2026-11-21-itil-remediation` (`cleanup`).
 *
 * What the plan found dead and this group removed: two whole files, the unused half of a third,
 * two unused server actions and a stray log, an unused model, and the two board columns nothing
 * ever read. The "repository still builds" half of T228/T231 is the typecheck CI runs over every
 * package; what is checked here is that nothing imports what is gone and nothing writes the
 * dropped columns. The behaviour of T232 is in
 * `src/test/integration/itilBoardLifecycle.integration.test.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

/** Every tracked source file of the packages this plan touches. */
function trackedSources(): string[] {
  const roots = ['packages', 'server/src', 'server/seeds', 'server/migrations', 'shared', 'ee/server/src', 'ee/packages', 'services'];
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

describe('ITIL cleanup', () => {
  it('T228: the two dead ITIL utility files are gone and nothing imports them', () => {
    for (const gone of [
      'server/src/lib/utils/itilUtils.ts',
      'packages/tickets/src/lib/itilUtils.server.ts',
    ]) {
      expect(fs.existsSync(path.resolve(REPO_ROOT, gone)), `${gone} must be deleted`).toBe(false);
    }

    const offenders = trackedSources().filter((file) => {
      if (file === __filename) return false;
      const text = fs.readFileSync(file, 'utf8');
      return /from\s+['"][^'"]*itilUtils\.server['"]/.test(text) || /lib\/utils\/itilUtils/.test(text);
    });
    expect(offenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it('T229: no source file imports a removed itilUtils export', () => {
    const remaining = source('packages/tickets/src/lib/itilUtils.ts');
    expect(remaining).toContain('export { ItilImpact, ItilUrgency, calculateItilPriority, ItilLabels };');
    for (const removed of [
      'ItilCategories',
      'ItilResolutionCodes',
      'formatItilCategoryDisplay',
      'getItilCategoriesAsTicketCategories',
      'isSlaBreached',
      'getEscalationLevel',
      'getSlaTarget',
      'ItilPriority',
    ]) {
      expect(remaining, `itilUtils must no longer export ${removed}`).not.toContain(`export function ${removed}`);
      expect(remaining).not.toContain(`export const ${removed}`);
    }

    // Whole import statements that name the module, so the specifier list is what is read.
    const removedSymbols =
      /\b(ItilCategories|ItilResolutionCodes|formatItilCategoryDisplay|getItilCategoriesAsTicketCategories|isSlaBreached|getEscalationLevel|getSlaTarget|ItilPriority)\b/;
    const offenders = trackedSources().filter((file) => {
      if (file === __filename) return false;
      const text = fs.readFileSync(file, 'utf8');
      const statements = text.match(/import\s+[\s\S]*?from\s+['"][^'"]*itilUtils(?:\.server)?['"]/g) ?? [];
      return statements.some((statement) => removedSymbols.test(statement));
    });
    expect(offenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it('T230: the unused ticket field option actions and the stray log are gone', () => {
    const actions = source('packages/integrations/src/actions/email-actions/ticketFieldOptionsActions.ts');
    expect(actions).not.toContain('export const getAvailablePriorities');
    expect(actions).not.toContain('export const getAvailableCategories');
    expect(actions).not.toContain("console.log('categories', categories)");

    const offenders = trackedSources().filter((file) => {
      if (file === __filename) return false;
      const text = fs.readFileSync(file, 'utf8');
      return /\bgetAvailablePriorities\b|\bgetAvailableCategories\b/.test(text);
    });
    expect(offenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it('T231: the unused category model is gone, with its import', () => {
    expect(fs.existsSync(path.resolve(REPO_ROOT, 'server/src/lib/models/ticketCategory.tsx'))).toBe(false);
    expect(source('server/src/lib/api/services/CategoryService.ts')).not.toContain('models/ticketCategory');

    const offenders = trackedSources().filter((file) => {
      if (file === __filename) return false;
      return /models\/ticketCategory['"]/.test(fs.readFileSync(file, 'utf8'));
    });
    expect(offenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it('T232: the two board display columns are dropped, accepted and never written', () => {
    const migration = source('server/migrations/20261123093000_drop_board_itil_display_columns.cjs');
    expect(migration).toContain("['display_itil_impact', 'display_itil_urgency']");
    expect(migration).toContain('table.dropColumn(column);');

    // Nothing writes them any more: not the board create, not the dev seed, not the portable
    // co-managed catalogue.
    expect(source('packages/tickets/src/services/boardLifecycle.ts')).not.toContain('display_itil_impact');
    expect(source('server/seeds/dev/85_itil_priorities.cjs')).not.toContain('display_itil_impact');
    expect(source('packages/co-managed/src/portableWorkCatalog.ts')).not.toContain('display_itil_impact');
    // And they are gone from the row types.
    expect(source('packages/types/src/interfaces/board.interface.ts')).not.toContain('display_itil_impact');
    expect(source('server/src/interfaces/board.interface.ts')).not.toContain('display_itil_impact');

    // But a payload that still carries them is accepted and stripped, on the web and on REST.
    const schema = source('packages/tickets/src/actions/board-actions/boardInputSchema.ts');
    expect(schema).toContain("const DROPPED_BOARD_COLUMNS = ['display_itil_impact', 'display_itil_urgency']");
    expect(schema).toContain('.transform(withoutDroppedColumns)');
    const restSchema = source('server/src/lib/api/schemas/board.ts');
    expect(restSchema).toContain('display_itil_impact: z.boolean().optional()');
    // The response no longer describes them.
    const response = restSchema.slice(restSchema.indexOf('export const boardResponseSchema'));
    expect(response).not.toContain('display_itil_impact');
  });
});
