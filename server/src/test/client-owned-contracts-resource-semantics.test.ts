import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const serverRoot = path.resolve(import.meta.dirname, '..', '..');
const repoRoot = path.resolve(serverRoot, '..');
const readServer = (rel: string) => fs.readFileSync(path.join(serverRoot, rel), 'utf8');
const readRepo = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

describe('client-owned contracts resource semantics', () => {
  it('T033: documents and returns /contracts as client-owned instantiated headers', () => {
    const controllerSource = readServer('src/lib/api/controllers/ApiContractLineController.ts');
    const serviceSource = readServer('src/lib/api/services/ContractLineService.ts');
    const schemaSource = readServer('src/lib/api/schemas/contractLineSchemas.ts');

    expect(controllerSource).toContain('GET /api/v2/contracts - List client-owned contract headers');
    expect(controllerSource).toContain('POST /api/v2/contracts - Create a client-owned contract header');
    expect(controllerSource).not.toContain('TODO: Implement listContracts in ContractLineService');
    expect(controllerSource).toContain('const result = await this.contractLineService.listContracts(listOptions, context);');

    expect(serviceSource).toContain('List client-owned contract headers exposed by the /contracts resource.');
    expect(serviceSource).toContain(".andWhere((builder) => builder.whereNull('c.is_template').orWhere('c.is_template', false))");
    expect(serviceSource).toContain(".whereNotNull('c.owner_client_id')");
    expect(serviceSource).toContain("'oc.client_name as owner_client_name'");
    expect(serviceSource).toContain("'c.status'");
    expect(serviceSource).toContain("status: data.status ?? 'draft'");
    expect(serviceSource).toContain("from(baseQuery.clone().as('client_owned_contracts'))");

    expect(schemaSource).toContain('owner_client_name: z.string().nullable().optional(),');
    expect(schemaSource).toContain('status: contractStatusSchema,');
  });

  it('T034: billing docs describe templates as the only reusable contract layer', () => {
    const billingDoc = readRepo('docs/billing/billing.md');

    expect(billingDoc).toContain('Represent reusable offer structures only through templates while keeping instantiated contract headers client-owned.');
    expect(billingDoc).toContain('A client-owned instantiated contract header.');
    expect(billingDoc).toContain('templates remain the only reusable definition layer');
    expect(billingDoc).toContain('/api/v1/contracts');
    expect(billingDoc).toContain('/api/v2/contracts');
    expect(billingDoc).toContain('Live client lifecycle still belongs to `client_contracts`');
  });
});
