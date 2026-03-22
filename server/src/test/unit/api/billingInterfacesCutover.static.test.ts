import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const serverBillingInterfacesSource = readFileSync(
  path.resolve(process.cwd(), 'src/interfaces/billing.interfaces.ts'),
  'utf8',
);
const sharedBillingInterfacesSource = readFileSync(
  path.resolve(process.cwd(), '../packages/types/src/interfaces/billing.interfaces.ts'),
  'utf8',
);
const financialSchemasSource = readFileSync(
  path.resolve(process.cwd(), 'src/lib/api/schemas/financialSchemas.ts'),
  'utf8',
);
const contractLineSchemasSource = readFileSync(
  path.resolve(process.cwd(), 'src/lib/api/schemas/contractLineSchemas.ts'),
  'utf8',
);

describe('billing schema/interface hard-cutover guards', () => {
  it('T013: server and shared billing interfaces no longer allow legacy per_unit billing_method unions', () => {
    expect(serverBillingInterfacesSource).not.toContain("'usage' | 'per_unit'");
    expect(sharedBillingInterfacesSource).not.toContain("'usage' | 'per_unit'");
  });

  it('T013: financial and contract-line schemas enforce canonical fixed/hourly/usage billing vocabulary', () => {
    expect(financialSchemasSource).toContain("export const billingMethodSchema = z.enum(['fixed', 'hourly', 'usage']);");
    expect(contractLineSchemasSource).toContain("export const billingMethodSchema = z.enum(['fixed', 'hourly', 'usage']);");
    expect(financialSchemasSource).not.toContain('per_unit');
    expect(contractLineSchemasSource).not.toContain('per_unit');
  });
});
