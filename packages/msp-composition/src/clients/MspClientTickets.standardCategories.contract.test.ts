/* @vitest-environment node */

/**
 * T109 — F057 of `ee/plans/2026-11-21-itil-remediation` (`category-filters`).
 *
 * The client and contact profile tabs render their ticket list from the options
 * `ClientCrossFeatureContext` loads, and that loader is `getTicketFormOptions` — the same action
 * that de-duplicates the standard categories to one entry per standard row (R9). A ticket on the
 * second ITIL board therefore carries a `category_id` the list no longer holds, and without the
 * alias map `formatCategoryLabel` reports it as unknown. This pins the thread: the detail screen
 * keeps the aliases beside the categories, the render props carry them, both providers hand them
 * on, and both lists pass them to `createTicketColumns`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGES = path.resolve(__dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(PACKAGES, relativePath), 'utf8');
}

describe('client and contact profile ticket lists', () => {
  it('T109: the client detail screen keeps the alias map beside the categories', () => {
    const source = read('clients/src/components/clients/ClientDetails.tsx');

    expect(source).toContain('categoryAliases?: Readonly<Record<string, string>>;');
    expect(source).toContain(
      'categoryAliases: (options as { categoryAliases?: Record<string, string> }).categoryAliases,'
    );
    expect(source).toContain('initialCategoryAliases: ticketFormOptions.categoryAliases,');
  });

  it('T109: both render props carry the alias map', () => {
    const source = read('clients/src/context/ClientCrossFeatureContext.tsx');

    const aliasProp = /initialCategoryAliases\?: Readonly<Record<string, string>>;/g;
    expect(source.match(aliasProp) ?? []).toHaveLength(2);
  });

  it.each([
    'msp-composition/src/clients/MspClientCrossFeatureProvider.tsx',
    'msp-composition/src/clients/AlgaDeskClientCrossFeatureProvider.tsx',
  ])('T109: %s hands the alias map to both lists', (file) => {
    const source = read(file);

    const passed = /initialCategoryAliases=\{props\.initialCategoryAliases\}/g;
    expect(source.match(passed) ?? []).toHaveLength(2);
  });

  it.each([
    'msp-composition/src/clients/MspClientTickets.tsx',
    'msp-composition/src/clients/MspContactTickets.tsx',
  ])('T109: %s resolves a row label through the alias map', (file) => {
    const source = read(file);

    expect(source).toContain('initialCategoryAliases');
    expect(source).toContain('categoryAliases: initialCategoryAliases,');
  });
});
