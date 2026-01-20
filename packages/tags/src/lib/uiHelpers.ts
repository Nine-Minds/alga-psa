/**
 * UI helpers for tags package
 *
 * These are dynamic import wrappers to avoid circular dependency:
 * tags -> ui -> ... -> clients -> tags
 */

export async function generateEntityColorAsync(name: string): Promise<{ backgroundColor: string; textColor: string }> {
  const module = await import('@alga-psa/ui/lib');
  const result = module.generateEntityColor(name);
  return { backgroundColor: result.background, textColor: result.text };
}
