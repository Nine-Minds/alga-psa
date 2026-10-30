import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source contract (card c150b8de): `contract_line_service_fixed_config.base_rate`
 * has two stored meanings, and `fixedMemberRate.ts` is the only code that turns
 * it into a contribution (per_unit -> rate x quantity, share -> as-is). No
 * reader may re-derive `base_rate x quantity` itself.
 *
 * The seat path (`pricing_basis='unit'`) is the one deliberate exception: a seat
 * is always per-unit and keeps its own Math.ceil rounding.
 */
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..');
const SCAN_ROOTS = [
  'shared/billingClients',
  'packages/billing/src',
  'packages/reporting/src',
  'ee/server/src/lib/billing',
];
const PATTERN = /base_rate.*\*\s*quantity|service_base_rate.*\*|baseRate.*\*\s*quantity/;

// file (repo-relative) -> reason the multiplication is legitimate.
const ALLOWED = new Map<string, string>([
  ['shared/billingClients/fixedMemberRate.ts', 'the single interpreter'],
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|d)\.tsx?$/.test(entry)) yield full;
  }
}

describe('fixed member base_rate has one interpreter', () => {
  it('no reader multiplies base_rate by quantity outside fixedMemberRate.ts', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = path.join(repoRoot, root);
      try {
        statSync(abs);
      } catch {
        continue; // ee/ is absent in some checkouts
      }
      for (const file of walk(abs)) {
        const rel = path.relative(repoRoot, file).split(path.sep).join('/');
        if (ALLOWED.has(rel)) continue;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((text, index) => {
            if (!text.trim().startsWith('//') && !text.trim().startsWith('*') && PATTERN.test(text)) {
              offenders.push(`${rel}:${index + 1}: ${text.trim()}`);
            }
          });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every reader selects base_rate_basis next to base_rate', () => {
    const readers = [
      'packages/billing/src/lib/billing/billingEngine.ts',
      'packages/billing/src/lib/billing/pricing/loadFixedLineRateInputs.ts',
      'packages/reporting/src/actions/report-actions/deferred-revenue/loaders.ts',
      'shared/billingClients/contractMonthlyValue.ts',
    ];
    for (const rel of readers) {
      const source = readFileSync(path.join(repoRoot, rel), 'utf8');
      expect(source, rel).toContain('base_rate_basis');
    }
  });
});
