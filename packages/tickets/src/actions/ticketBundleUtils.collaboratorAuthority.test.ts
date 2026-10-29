// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertBundlePropagationAuthority } from '../lib/ticketBundlePropagation';

const repoRoot = path.resolve(__dirname, '../../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('assertBundlePropagationAuthority', () => {
  it('refuses a co-managed collaborator edit that would write bundle children', () => {
    expect(() => assertBundlePropagationAuthority({ collaborator: true }))
      .toThrow('Shared bundle workflow edits require authority for every child ticket');
  });

  it('never refuses a native caller (master close, auto-close, API)', () => {
    expect(() => assertBundlePropagationAuthority({})).not.toThrow();
    expect(() => assertBundlePropagationAuthority({ collaborator: false })).not.toThrow();
    expect(() => assertBundlePropagationAuthority({ collaborator: undefined })).not.toThrow();
  });
});

describe('bundle propagation authority placement', () => {
  const utils = read('packages/tickets/src/actions/ticketBundleUtils.ts');
  const start = utils.indexOf('export async function propagateBundleMasterStatus');
  const body = utils.slice(start);

  it('guards both the legacy mirror and the boundary path, and only after their no-op returns', () => {
    const calls = [...body.matchAll(/assertBundlePropagationAuthority\(ctx\)/g)].map(m => m.index!);
    expect(calls).toHaveLength(2);
    // Legacy mirror: an update with nothing to mirror returns before the guard.
    const emptyReturn = body.indexOf("if (Object.keys(propagateFields).length === 0)");
    expect(emptyReturn).toBeGreaterThan(-1);
    expect(calls[0]).toBeGreaterThan(emptyReturn);
    // Boundary path: a close/reopen with no affected child returns before the guard,
    // so a collaborator closing a master that has nothing to propagate still succeeds.
    const noAffected = body.indexOf('if (affected.length === 0)');
    expect(noAffected).toBeGreaterThan(-1);
    expect(calls[1]).toBeGreaterThan(noAffected);
    // ...and before any child write or confirmation preview.
    expect(calls[1]).toBeLessThan(body.indexOf('options.propagateToChildren === undefined'));
  });

  it('is only ever engaged by the collaboration path of updateTicketInTransaction', () => {
    const optimized = read('packages/tickets/src/actions/optimizedTicketActions.ts');
    expect(optimized).toContain('collaborator: Boolean(collaboration)');
    // No other caller (API ticket service, auto-close, workflow) sets the flag.
    expect(read('server/src/lib/api/services/TicketService.ts')).not.toMatch(/collaborator\s*:/);
    expect(utils.match(/collaborator\s*:\s*true/g)).toBeNull();
  });
});
