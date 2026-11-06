/** Stable, iterative ordering of records within a self-referencing entity (folders, replies).
 * External/missing references are validated separately. No recursion or source-specific IDs. */
export function orderAmpRecords<T extends Record<string, unknown>>(rows: readonly T[], columns: readonly string[]): T[] {
  if (!columns.length) return [...rows];
  const byId = new Map(rows.map(row => [String(row.package_record_id), row]));
  const pending = new Map<string, number>(), children = new Map<string, string[]>();
  for (const row of rows) {
    const id = String(row.package_record_id);
    const parents = new Set(columns.map(column => row[column]).filter(value => value != null && byId.has(String(value))).map(String));
    pending.set(id, parents.size);
    for (const parent of parents) { const list = children.get(parent) ?? []; list.push(id); children.set(parent, list); }
  }
  const queue = [...pending].filter(([, count]) => count === 0).map(([id]) => id).sort();
  const ordered: T[] = [];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]; ordered.push(byId.get(id)!);
    for (const child of children.get(id) ?? []) {
      const count = pending.get(child)! - 1; pending.set(child, count);
      if (!count) queue.push(child);
    }
  }
  if (ordered.length !== rows.length) throw new Error('AMP self-reference cycle');
  return ordered;
}
