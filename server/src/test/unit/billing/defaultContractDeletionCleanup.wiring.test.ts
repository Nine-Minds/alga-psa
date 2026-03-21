import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepo = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../../../../../', relativePath), 'utf8');

describe('default-contract client-delete cleanup parity wiring', () => {
  it('T012: package client delete path removes billing settings/cycles and client-contract assignment artifacts', () => {
    const source = readRepo('packages/clients/src/actions/clientActions.ts');

    expect(source).toContain("trx('client_contracts')");
    expect(source).toContain("trx('client_billing_cycles')");
    expect(source).toContain("trx('client_billing_settings')");
    expect(source).toContain("deleteEntityWithValidation('client', clientId");
  });

  it('T013: API client delete path invokes shared cleanup including default-contract assignment/header cleanup', () => {
    const source = readRepo('server/src/lib/api/services/ClientService.ts');

    expect(source).toContain('await this.cleanupClientDeleteArtifacts(trx, context.tenant, id);');
    expect(source).toContain('await this.cleanupDefaultContractsForDeletedClient(trx, tenant, clientId);');
    expect(source).toContain("await this.deleteFromTableIfExists(trx, 'client_billing_settings'");
    expect(source).toContain("await this.deleteFromTableIfExists(trx, 'client_billing_cycles'");
    expect(source).toContain("await trx('client_contracts')");
    expect(source).toContain('is_system_managed_default: true');
  });
});
