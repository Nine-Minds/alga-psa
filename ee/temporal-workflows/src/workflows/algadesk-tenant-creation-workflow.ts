import type { TenantCreationInput, TenantCreationResult } from '../types/workflow-types.js';
import { runTenantCreationOrchestration } from './shared/tenant-creation-steps.js';

/**
 * AlgaDesk tenant creation workflow.
 *
 * Mirrors the PSA tenant creation flow (same activities, same seeds, same
 * rollback semantics). Differs only in the customer-tracking tag applied in
 * the Nine Minds tenant and the product-specific welcome email selected by
 * `input.productCode === 'algadesk'`.
 */
export async function algadeskTenantCreationWorkflow(
  input: TenantCreationInput
): Promise<TenantCreationResult> {
  return runTenantCreationOrchestration(
    { ...input, productCode: 'algadesk' },
    { customerTag: 'AlgaDesk Customer' }
  );
}
