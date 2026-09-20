import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The requirement IDs this card owes, read from the plans on disk.
 *
 * Both the inventory builder and the readiness verifier read this, and neither
 * reads the other's output for the set — that is what makes "a requirement
 * silently disappeared" detectable instead of self-confirming. If a plan loses
 * an ID, the inventory stops producing it and the verifier starts reporting it
 * absent; if the inventory invents one, the verifier reports it unknown.
 */
export const CO_MANAGED_PLANS = {
  foundation: 'docs/plans/2026-09-06-co-managed-it-plan.md',
  clientIntegration: 'docs/plans/2026-09-11-co-managed-client-integration',
  ticketList: 'docs/plans/2026-09-11-co-managed-ticket-list-unification',
  correction: 'docs/plans/2026-09-20-co-managed-it-completion',
};

/** Row counts the plans are known to carry. A shrinking plan is a failure. */
export const EXPECTED_COUNTS = {
  foundation: 22,
  'clientIntegration:feature': 33,
  'clientIntegration:test': 21,
  'ticketList:feature': 39,
  'ticketList:test': 20,
  'correction:feature': 32,
  'correction:test': 26,
};

/** Foundation T01–T22, parsed from the plan's behavioral table. */
export function foundationContracts(root) {
  const text = readFileSync(path.join(root, CO_MANAGED_PLANS.foundation), 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    const match = /^\|\s*(T\d{2})\s+([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (!match) continue;
    if (rows.some((row) => row.id === match[1])) continue;
    rows.push({ id: match[1], title: match[2], description: match[3] });
  }
  return rows;
}

/**
 * The PRD's acceptance-coverage table: foundation contract -> the CT IDs that
 * are supposed to prove it. Parsed rather than retyped so it cannot drift.
 */
export function foundationAcceptance(root) {
  const text = readFileSync(path.join(root, `${CO_MANAGED_PLANS.correction}/PRD.md`), 'utf8');
  const map = {};
  for (const line of text.split('\n')) {
    const match = /^\|\s*(T\d{2})\b[^|]*\|\s*(.+?)\s*\|\s*$/.exec(line);
    if (!match) continue;
    const ids = [...match[2].matchAll(/CT\d{3}/g)].map((m) => m[0]);
    if (ids.length) map[match[1]] = [...new Set(ids)];
  }
  return map;
}

export function planRows(root, plan, file) {
  return JSON.parse(readFileSync(path.join(root, CO_MANAGED_PLANS[plan], file), 'utf8'));
}

/**
 * Every requirement key, in the `plan:ID` form the inventory and manifest use
 * (foundation and correction rows are bare IDs, matching their plans).
 *
 * @returns {{ keys: string[], failures: string[] }}
 */
export function coManagedRequirementKeys(root) {
  const keys = [];
  const failures = [];
  const counts = {};
  const bump = (bucket) => { counts[bucket] = (counts[bucket] ?? 0) + 1; };

  for (const row of foundationContracts(root)) {
    keys.push(row.id);
    bump('foundation');
  }

  for (const plan of ['clientIntegration', 'ticketList', 'correction']) {
    for (const [kind, file] of [['feature', 'features.json'], ['test', 'tests.json']]) {
      for (const row of planRows(root, plan, file)) {
        if (typeof row?.id !== 'string' || !row.id) {
          failures.push(`${plan}/${file}: row without an id`);
          continue;
        }
        keys.push(plan === 'correction' ? row.id : `${plan}:${row.id}`);
        bump(`${plan}:${kind}`);
      }
    }
  }

  for (const [bucket, want] of Object.entries(EXPECTED_COUNTS)) {
    if (counts[bucket] !== want) {
      failures.push(`${bucket}: plan carries ${counts[bucket] ?? 0} rows, expected ${want}`);
    }
  }
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  for (const key of new Set(duplicates)) failures.push(`duplicate requirement key in the plans: ${key}`);

  return { keys, failures, counts };
}
