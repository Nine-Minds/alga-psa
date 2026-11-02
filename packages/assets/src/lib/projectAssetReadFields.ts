/** Remove policy-redacted paths from an asset and its nested response values. */
export function projectAssetReadFields<T>(value: T, redactedFields: readonly string[] = []): T {
  const paths = new Set(redactedFields.map((field) => field.replace(/^assets?\./, '').replace(/^asset\./, '')));
  const aliases = [
    ['contact_name_id', 'contact_name'],
    ['client.client_name', 'client_name'],
    ['client_id', 'client.client_id'],
    ['vendor_id', 'vendor_name'],
    ['billing_profile_id', 'billing_profile_name'],
    ['name', 'maintenanceReport.asset_name'],
  ];
  const pathsOverlap = (left: string, right: string) =>
    left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
  const isMasked = (field: string) => [...paths].some((path) => pathsOverlap(field, path));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const group of aliases) {
      if (group.some(isMasked)) {
        for (const field of group) {
          if (!paths.has(field)) {
            paths.add(field);
            expanded = true;
          }
        }
      }
    }
  }

  const project = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item) => project(item, path));
    if (!node || typeof node !== 'object') return node;
    const prototype = Object.getPrototypeOf(node);
    if (prototype !== Object.prototype && prototype !== null) return node;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      // History stores asset values below a `changes`/`fields` wrapper. Match
      // asset paths at any depth there, and also support flattened dotted keys.
      const isHistoryValue = path === 'changes' || path.startsWith('changes.');
      const historyPath = childPath.startsWith('changes.') ? childPath.slice('changes.'.length) : key;
      const historyFieldMatch = isHistoryValue && [...paths].some((redactedPath) =>
        pathsOverlap(historyPath, redactedPath) || (!redactedPath.includes('.') && historyPath.endsWith(`.${redactedPath}`))
      );
      if (paths.has(childPath) || historyFieldMatch) continue;
      if (isHistoryValue && (key === 'before' || key === 'after' || key === 'previous_value' || key === 'new_value' || key === 'old_value' || key === 'value')) {
        const field = (node as Record<string, unknown>).field ?? (node as Record<string, unknown>).field_name ?? (node as Record<string, unknown>).path;
        if (typeof field === 'string' && [...paths].some((redactedPath) => pathsOverlap(field, redactedPath))) continue;
      }
      result[key] = project(child, childPath);
    }
    return result;
  };

  return project(value, '') as T;
}
