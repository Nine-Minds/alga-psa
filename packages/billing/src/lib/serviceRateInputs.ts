/**
 * Rate text is held in index-keyed maps alongside the service rows of the
 * contract-line authoring dialogs. Removing a row shifts every later row down
 * one, so the stored strings have to shift with them or each remaining row
 * would be paired with its predecessor's rate.
 */
export const reindexRateInputs = (
  inputs: Record<number, string>,
  removedIndex: number,
): Record<number, string> => {
  const next: Record<number, string> = {};
  for (const [key, value] of Object.entries(inputs)) {
    const index = Number(key);
    if (index < removedIndex) {
      next[index] = value;
    } else if (index > removedIndex) {
      next[index - 1] = value;
    }
  }
  return next;
};
