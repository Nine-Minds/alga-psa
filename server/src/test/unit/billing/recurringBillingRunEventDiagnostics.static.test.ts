import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('recurring billing run diagnostic contracts', () => {
  it('T067: recurring workflow and job diagnostics no longer emit bridge-specific recurring payload fields', () => {
    const eventBuildersSource = readFileSync(
      resolve(
        __dirname,
        '../../../../../shared/workflow/streams/domainEventBuilders/recurringBillingRunEventBuilders.ts',
      ),
      'utf8',
    );
    const eventSchemasSource = readFileSync(
      resolve(
        __dirname,
        '../../../../../shared/workflow/runtime/schemas/billingEventSchemas.ts',
      ),
      'utf8',
    );
    const jobHandlerSource = readFileSync(
      resolve(__dirname, '../../../lib/jobs/handlers/generateInvoiceHandler.ts'),
      'utf8',
    );
    const jobsIndexSource = readFileSync(
      resolve(__dirname, '../../../lib/jobs/index.ts'),
      'utf8',
    );

    expect(eventBuildersSource).toContain("selectionMode?: RecurringBillingRunSelectionMode;");
    expect(eventBuildersSource).toContain("windowIdentity?: RecurringBillingRunWindowIdentity;");
    expect(eventBuildersSource).toContain(
      "executionWindowKinds?: RecurringBillingRunExecutionWindowKind[];",
    );
    expect(eventBuildersSource).not.toContain('billingCycleId');
    expect(eventBuildersSource).not.toContain('billing_cycle_id');
    expect(eventBuildersSource).not.toContain('billing_cycle_window');

    expect(eventSchemasSource).toContain("enum(['client_cadence_window', 'contract_cadence_window', 'mixed_execution_windows'])");
    expect(eventSchemasSource).toContain("enum(['client_cadence_window', 'contract_cadence_window'])");
    expect(eventSchemasSource).not.toContain('billingCycleId');
    expect(eventSchemasSource).not.toContain('billing_cycle_id');
    expect(eventSchemasSource).not.toContain('billing_cycle_window');
    expect(eventSchemasSource).not.toContain('hasBillingCycleBridge');

    expect(jobHandlerSource).toContain('Recurring invoice job is missing selectorInput.');
    expect(jobHandlerSource).not.toContain('billingCycleId');
    expect(jobsIndexSource).toContain('scheduleRecurringWindowInvoiceGeneration');
    expect(jobsIndexSource).not.toContain('billingCycleId?:');
  });
});
