/**
 * UI helpers for tags package
 *
 * TODO: Consolidate with @alga-psa/ui after circular dependency is resolved
 */

import { generateEntityColor } from './colorUtils';

export async function generateEntityColorAsync(name: string): Promise<{ backgroundColor: string; textColor: string }> {
  const result = generateEntityColor(name);
  return { backgroundColor: result.background, textColor: result.text };
}
