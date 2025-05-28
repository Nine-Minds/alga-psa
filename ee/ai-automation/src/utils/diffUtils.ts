import { PageState } from '../types/ui-reflection.js';
import { create } from 'jsondiffpatch';

let diffPatcher: any = null;

async function initDiffPatcher() {
  if (!diffPatcher) {
    diffPatcher = create({
      // Configure for our specific needs
      // objectHash: (obj: any) => obj.id, // Use id field for object identity
      arrays: {
        detectMove: true,
        includeValueOnMove: true
      }
    });
  }
  return diffPatcher;
}

/**
 * Computes the difference between two UI states
 * @param oldState Previous UI state
 * @param newState Current UI state
 * @returns Difference object showing what changed
 */
export async function computeDiff(oldState: PageState | null, newState: PageState): Promise<any> {
  // Handle case where there was no previous state
  if (!oldState) {
    return {
      type: 'initial',
      state: newState
    };
  }

  // Initialize diffPatcher if needed
  const patcher = await initDiffPatcher();

  // Compute detailed diff
  const diff = patcher.diff(oldState, newState);

  return diff;
}
