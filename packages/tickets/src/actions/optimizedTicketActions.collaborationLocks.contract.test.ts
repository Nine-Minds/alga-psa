// @vitest-environment node
//
// CM L3b1 A4 (static half): a native (psa) ticket update takes no row lock that
// it did not take before the collaboration seam, and every new statement the seam
// adds is reachable only when a `collaboration` context is present. The measured
// half (per-step statement and lock counts) is the L0g harness:
// `npm run budget:hot-path` (needs a migrated database; see the card summary).

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const source = fs.readFileSync(path.join(repoRoot, 'packages/tickets/src/actions/optimizedTicketActions.ts'), 'utf8');

const start = source.indexOf('export async function updateTicketInTransaction');
const end = source.indexOf('export const updateTicketWithCache', start);
const body = source.slice(start, end);

/** Source text of the block opened by the first `{` after `index`, with its matching close. */
function block(text: string, index: number): string {
  const open = text.indexOf('{', index);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error('unbalanced block');
}

describe('updateTicketInTransaction lock participation', () => {
  it('finds the function under test', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('takes exactly two row locks: the attributes-only ticket lock (unchanged) and a collaboration-only bundle share lock', () => {
    const locks = [...body.matchAll(/\.for(Update|Share)\(\)/g)];
    expect(locks.map(m => m[0])).toEqual(['.forUpdate()', '.forShare()']);
  });

  it('adds the collaboration condition to the ticket lock only as an OR with the native condition', () => {
    expect(body).toContain('(validatedData as Record<string, unknown>).attributes !== undefined || collaboration');
  });

  it('takes the bundle share lock only inside the collaboration branch', () => {
    const lockAt = body.indexOf('.forShare()');
    const branchAt = body.lastIndexOf('if (collaboration) {', lockAt);
    expect(branchAt).toBeGreaterThan(-1);
    const branch = block(body, branchAt);
    expect(branchAt + branch.length).toBeGreaterThan(lockAt);
  });

  it('asserts write authority and resolves the collaborator only when a collaboration context exists', () => {
    expect(body).toMatch(/collaboration\s*\?\s*await resolveTicketMutationCollaborator\(/);
    const assertAt = body.indexOf('collaboration.assertWriteAuthority(trx)');
    expect(assertAt).toBeGreaterThan(-1);
    expect(body.lastIndexOf('if (collaboration)', assertAt)).toBeGreaterThan(-1);
  });

  it('does not call the co-managed write admission directly (the L0c seam backs the tenantDb terminals)', () => {
    expect(body).not.toContain('assertCoManagedOperationalWrite');
    expect(body).not.toContain('evaluateCapability');
  });
});
