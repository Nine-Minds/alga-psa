/**
 * Users helpers for tags package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * tags -> users -> auth -> ui -> ... -> clients -> tags
 */

export async function getCurrentUserAsync() {
  const module = await import('@alga-psa/users/actions');
  return module.getCurrentUser();
}
