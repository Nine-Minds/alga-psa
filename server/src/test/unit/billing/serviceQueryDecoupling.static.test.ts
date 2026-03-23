import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const serviceCatalogServiceSource = readFileSync(
  path.resolve(process.cwd(), 'src/lib/api/services/ServiceCatalogService.ts'),
  'utf8',
);

const sharedServiceQuerySource = readFileSync(
  path.resolve(process.cwd(), '../shared/billingClients/services.ts'),
  'utf8',
);

describe('service query decoupling guards', () => {
  it('T014: service catalog API applies billing-method filter/sort only in service item-kind context', () => {
    expect(serviceCatalogServiceSource).toContain("const supportsServiceBillingMetadata = itemKind === 'service'");
    expect(serviceCatalogServiceSource).toContain('if (filters.billing_method && supportsServiceBillingMetadata)');
    expect(serviceCatalogServiceSource).toContain(
      "sortField === 'billing_method' && !supportsServiceBillingMetadata",
    );
  });

  it('T014: shared billing-clients helper mirrors service-only billing-method filter/sort semantics', () => {
    expect(sharedServiceQuerySource).toContain(
      "const supportsServiceBillingMetadata = sanitizedOptions.item_kind === 'service'",
    );
    expect(sharedServiceQuerySource).toContain(
      'if (sanitizedOptions.billing_method && supportsServiceBillingMetadata)',
    );
    expect(sharedServiceQuerySource).toContain(
      "sanitizedOptions.sort === 'billing_method' && !supportsServiceBillingMetadata",
    );
  });
});
