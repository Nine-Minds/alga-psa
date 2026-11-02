/** Reads a dotted path from a record. Arrays met on the way are flattened, like JSONata. */
export const readPath = (record: unknown, path: string): unknown => {
  let current: unknown[] = [record];
  let sawArray = false;
  for (const segment of path.split('.')) {
    const next: unknown[] = [];
    for (const item of current) {
      if (item === null || item === undefined || typeof item !== 'object') continue;
      const value = (item as Record<string, unknown>)[segment];
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        sawArray = true;
        next.push(...value);
      } else {
        next.push(value);
      }
    }
    current = next;
  }
  if (sawArray) return current;
  return current.length === 0 ? undefined : current[0];
};
