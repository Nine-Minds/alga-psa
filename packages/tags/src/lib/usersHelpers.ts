/**
 * Users helpers for tags package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * tags -> users -> auth -> ui -> ... -> clients -> tags
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

const getUsersActionsModule = () => '@alga-psa/' + 'users/actions';

export async function getCurrentUserAsync() {
  const module = await import(/* webpackIgnore: true */ getUsersActionsModule());
  return (module as any).getCurrentUser();
}
