/**
 * Register a model's mutable columns and produce a runtime projection for
 * untrusted update payloads. SQL update objects stay closed over an explicit
 * column set even when callers bypass TypeScript types.
 */
export function registerUpdatableColumns<Row extends object>() {
  return <Column extends keyof Row>(columns: readonly Column[]) => {
    const allowed = new Set<PropertyKey>(columns);

    return (candidate: unknown): Partial<Pick<Row, Column>> => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return {};
      }

      const input = candidate as Record<PropertyKey, unknown>;
      const update: Partial<Pick<Row, Column>> = {};
      for (const column of allowed) {
        if (Object.prototype.hasOwnProperty.call(input, column)) {
          (update as Record<PropertyKey, unknown>)[column] = input[column];
        }
      }
      return update;
    };
  };
}
