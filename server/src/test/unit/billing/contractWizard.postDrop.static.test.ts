import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const contractWizardSource = fs.readFileSync(
  path.join(repoRoot, '../packages/billing/src/actions/contractWizardActions.ts'),
  'utf8',
);

describe('contract wizard post-drop source guards', () => {
  it('does not write dropped client-contract line tables during client contract creation', () => {
    expect(contractWizardSource).toContain("await trx('client_contracts').insert(clientContractInsertData);");
    expect(contractWizardSource).not.toContain("trx('client_contract_lines').insert");
    expect(contractWizardSource).not.toContain("trx('client_contract_services').insert");
    expect(contractWizardSource).not.toContain('replicateContractLinesToClient');
  });
});
