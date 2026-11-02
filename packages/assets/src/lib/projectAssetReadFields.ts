/** Remove policy-redacted paths from an asset and its nested response values. */
export function projectAssetReadFields<T>(value: T, redactedFields: readonly string[] = []): T {
  const paths = new Set(redactedFields.map((field) => field.replace(/^assets?\./, '').replace(/^asset\./, '')));
  const aliases = [
    ['contact_name_id', 'contact_name'],
    ['client.client_name', 'client_name'],
    ['vendor_id', 'vendor_name'],
    ['billing_profile_id', 'billing_profile_name'],
    ['name', 'maintenanceReport.asset_name'],
  ];
  for (const group of aliases) {
    if (group.some((field) => paths.has(field))) group.forEach((field) => paths.add(field));
  }

  const project = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item) => project(item, path));
    if (!node || typeof node !== 'object') return node;
    const prototype = Object.getPrototypeOf(node);
    if (prototype !== Object.prototype && prototype !== null) return node;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (paths.has(childPath)) continue;
      result[key] = project(child, childPath);
    }
    return result;
  };

  return project(value, '') as T;
}
