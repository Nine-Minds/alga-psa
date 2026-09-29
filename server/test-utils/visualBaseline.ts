import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Baselines are reviewed inputs. Only an explicit local update may write them. */
export async function loadVisualBaseline(
  baselinePath: string,
  actual: Buffer,
  options: { update: boolean; ci: boolean },
): Promise<{ baseline: Buffer; updated: boolean }> {
  if (options.update) {
    if (options.ci) throw new Error('Visual baseline updates are forbidden in CI');
    await fs.mkdir(path.dirname(baselinePath), { recursive: true });
    await fs.writeFile(baselinePath, actual);
    return { baseline: actual, updated: true };
  }
  try {
    return { baseline: await fs.readFile(baselinePath), updated: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(`Missing visual baseline: ${baselinePath}. Generate with UPDATE_VISUAL_BASELINES=1 locally, review the PNG, and commit it.`);
  }
}
