// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T004: the URL entry points fold a legacy `clientId` through the one migration step, and the
 * writers never emit it. (The parsers are not exported, so this reads their source, like the
 * descriptor-table wiring test does.)
 */
const read = (...parts: string[]) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
const container = read('..', 'components', 'TicketingDashboardContainer.tsx');
const dashboard = read('..', 'components', 'TicketingDashboard.tsx');
const page = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'server', 'src', 'app', 'msp', 'tickets', 'page.tsx'), 'utf8');
const utils = read('ticketFilterUtils.ts');

describe('legacy clientId folding and writers', () => {
  it('folds clientId in the container parser, the server page and parseReturnFilters', () => {
    expect(container).toContain('foldLegacyClientId({');
    expect(page).toContain('foldLegacyClientId(filtersFromURL)');
    expect(utils).toMatch(/return foldLegacyClientId\(\{[\s\S]*where: decodeTicketWhere/);
    // The fold is the migration's v2 -> v3 step, not a second implementation.
    expect(utils).toContain('migrateTicketFilters(filters as Record<string, unknown>, 2)');
  });

  it('the URL writers and the CSV export filters never set clientId', () => {
    expect(container).not.toContain("params.set('clientId'");
    expect(dashboard).not.toContain("params.set('clientId'");
    expect(dashboard).not.toMatch(/exportFilters[\s\S]{0,400}clientId:/);
  });
});
