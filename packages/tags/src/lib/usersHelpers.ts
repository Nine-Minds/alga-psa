/**
 * Users helpers for tags package
 *
 * TODO: Consolidate after circular dependency is resolved
 */

// Use string concatenation to hide import from Nx static analysis
const getAuthModule = () => '@alga-psa/' + 'auth/getCurrentUser';

export async function getCurrentUserAsync() {
  const module = await import(/* webpackIgnore: true */ getAuthModule());
  return module.getCurrentUser();
}
