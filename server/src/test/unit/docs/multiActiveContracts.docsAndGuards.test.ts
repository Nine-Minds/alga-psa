import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');

const read = (...segments: string[]): string =>
  fs.readFileSync(path.join(repoRoot, ...segments), 'utf8');

const runRg = (pattern: string, targets: string[]): string => {
  const result = spawnSync('rg', ['-n', pattern, ...targets], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status === 1) {
    return '';
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `rg failed with status ${result.status}`);
  }
  return result.stdout.trim();
};

describe('multi-active contracts docs and static guards', () => {
  it('T052/T063/T064: static guard checks prevent singleton UI/action helper patterns from reappearing in live product paths', () => {
    const singletonUiActionMatches = runRg(
      'disabledClientIds|checkClientHasActiveContract|fetchClientIdsWithActiveContracts|terminate their current contract',
      [
        'packages/billing/src/components/billing-dashboard/contracts',
        'packages/billing/src/actions',
        'packages/clients/src',
      ]
    );
    expect(singletonUiActionMatches).toBe('');

    const hasActiveContractMatches = runRg(
      'hasActiveContractForClient',
      ['packages/billing/src', 'packages/clients/src', 'shared/billingClients']
    );
    expect(hasActiveContractMatches).toBe('');

    const activeClientListMatches = runRg(
      'getClientIdsWithActiveContracts',
      ['packages/billing/src', 'packages/clients/src', 'shared/billingClients']
    );
    expect(activeClientListMatches).toBe('');
  });

  it('T053: billing docs no longer claim assignment overlap blocking as an invariant', () => {
    const billingDocs = read('docs', 'billing', 'billing.md');
    expect(billingDocs).toContain('Concurrent active assignments (including overlapping dates) are allowed');
    expect(billingDocs).not.toContain('ensures there is no overlap with other active contracts');
  });

  it('T054: contract PO plan/runbook language no longer depends on single-active-contract assumptions', () => {
    const poPrd = read('ee', 'docs', 'plans', '2026-01-05-contract-purchase-order-support', 'PRD.md');
    const poScratchpad = read('ee', 'docs', 'plans', '2026-01-05-contract-purchase-order-support', 'SCRATCHPAD.md');

    expect(poPrd).toContain('single-assignment invoice scope; independent of whether the client has other active assignments');
    expect(poScratchpad).toContain('single-assignment invoice scope; does not require a single active contract per client');
  });

  it('T062: mixed-currency restriction remains explicit and separate from removed singleton guards', () => {
    const assignmentWritesSource = read('shared', 'billingClients', 'clientContracts.ts');
    expect(assignmentWritesSource).toContain('findMixedCurrencyActiveAssignment');
    expect(assignmentWritesSource).toContain('Mixed-currency contracts for the same client are not supported.');
    expect(assignmentWritesSource).not.toContain('hasActiveContractForClient');
  });

  it('T071: migration/runbook notes explicitly record invoice assignment snapshots as the preserved boundary', () => {
    const scratchpad = read('ee', 'docs', 'plans', '2026-03-20-multi-active-contracts-per-client', 'SCRATCHPAD.md');
    expect(scratchpad).toContain('Invoice tables already snapshot `client_contract_id`');
    expect(scratchpad).toContain('does not require invoice schema redesign to preserve single-assignment invoices');
  });
});
