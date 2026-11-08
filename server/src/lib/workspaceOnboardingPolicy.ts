import type { ProductCode } from '@alga-psa/types';

/** Co-managed workspaces are provisioned before customer consent and do not
 * use the MSP workspace setup wizard. */
export function productUsesWorkspaceOnboarding(productCode: ProductCode): boolean {
  return productCode !== 'co_managed';
}
