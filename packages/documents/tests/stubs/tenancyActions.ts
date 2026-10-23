/**
 * Test stub for `@alga-psa/tenancy/actions` in the documents workspace.
 *
 * Documents.tsx only needs `getExperimentalFeatures` for gating. Importing the
 * real tenancy actions barrel pulls server-only modules (tenant logo storage)
 * that cannot run in the jsdom component-test environment.
 */
export const getExperimentalFeatures = async (): Promise<Record<string, boolean>> => ({});
