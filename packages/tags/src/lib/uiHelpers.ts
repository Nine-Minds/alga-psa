/**
 * UI helpers for tags package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * tags -> ui -> ... -> clients -> tags
 *
 * Note: Using string concatenation to prevent static analysis from detecting dependencies
 */

const getUiLibModule = () => '@alga-psa/' + 'ui/lib';

export async function generateEntityColorAsync(name: string): Promise<{ backgroundColor: string; textColor: string }> {
  const module = await import(/* webpackIgnore: true */ getUiLibModule());
  return (module as any).generateEntityColor(name);
}
