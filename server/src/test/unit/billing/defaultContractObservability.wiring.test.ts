import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepo = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../../../../../', relativePath), 'utf8');

describe('default-contract observability wiring', () => {
  it('F051/F054: default-contract ensure emits created/reused structured logs with metric markers', () => {
    const source = readRepo('shared/billingClients/defaultContract.ts');
    expect(source).toContain("console.info('[default_contract.ensure]'");
    expect(source).toContain("event: 'default_contract.ensure'");
    expect(source).toContain("'default_contract_created'");
    expect(source).toContain("'default_contract_reused'");
  });

  it('F052/F054: resolver paths emit explicit/default/ambiguous routing decisions with unresolved markers', () => {
    const schedulingSource = readRepo('packages/scheduling/src/lib/contractLineDisambiguation.ts');
    const billingSource = readRepo('packages/billing/src/lib/contractLineDisambiguation.ts');

    expect(schedulingSource).toContain("console.info('[contract_line_resolver.routing]'");
    expect(schedulingSource).toContain("decision: 'explicit'");
    expect(schedulingSource).toContain("decision: 'default'");
    expect(schedulingSource).toContain("decision: 'ambiguous_or_unresolved'");
    expect(schedulingSource).toContain("'unresolved_ambiguous_count'");

    expect(billingSource).toContain("console.info('[contract_line_resolver.routing]'");
    expect(billingSource).toContain("decision: 'explicit'");
    expect(billingSource).toContain("decision: 'default'");
    expect(billingSource).toContain("decision: 'ambiguous_or_unresolved'");
    expect(billingSource).toContain("'unresolved_ambiguous_count'");
  });

  it('F053/F054: billing-engine reconciliation emits write-back and skip outcomes with deterministic/ambiguous markers', () => {
    const source = readRepo('packages/billing/src/lib/billing/billingEngine.ts');
    expect(source).toContain('console.info("[billing_engine.reconcile.unresolved]"');
    expect(source).toContain('decision: "deterministic_single_match"');
    expect(source).toContain('decision: eligibleLineIds.length > 1 ? "ambiguous" : "no_match"');
    expect(source).toContain('"unmatched_resolved_deterministically"');
    expect(source).toContain('"unresolved_ambiguous_count"');
  });

  it('T017: structured observability payloads avoid obvious PII fields', () => {
    const ensureSource = readRepo('shared/billingClients/defaultContract.ts');
    const schedulingSource = readRepo('packages/scheduling/src/lib/contractLineDisambiguation.ts');
    const billingSource = readRepo('packages/billing/src/lib/contractLineDisambiguation.ts');
    const engineSource = readRepo('packages/billing/src/lib/billing/billingEngine.ts');

    expect(ensureSource).not.toContain('clientName');
    expect(ensureSource).not.toContain('billing_email');
    expect(schedulingSource).not.toContain('clientName');
    expect(schedulingSource).not.toContain('email');
    expect(billingSource).not.toContain('clientName');
    expect(billingSource).not.toContain('email');
    expect(engineSource).not.toContain('clientName');
    expect(engineSource).not.toContain('email');
  });
});
