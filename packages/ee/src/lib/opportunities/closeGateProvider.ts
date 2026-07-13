// Keep the CE stub dependency-neutral. The empty array is structurally valid
// for the opportunity close-gate registry without importing the vertical
// Opportunities package back into the horizontal EE-stubs package.
export async function getEnterpriseOpportunityCloseGates(): Promise<[]> {
  return [];
}
