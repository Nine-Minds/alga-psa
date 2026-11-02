/** Remove policy-redacted paths from an asset and its nested response values. */
export function projectAssetReadFields<T>(value: T, redactedFields: readonly string[] = []): T {
  const paths = new Set(redactedFields.map((field) => field.replace(/^assets?\./, '').replace(/^asset\./, '')));
  const project = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item) => project(item, path));
    if (!node || typeof node !== 'object') return node;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (paths.has(key) || paths.has(childPath)) continue;
      result[key] = project(child, childPath);
    }
    return result;
  };

  const projected = project(value, '') as Record<string, unknown>;
  const aliases: Record<string, string[]> = {
    client_name: ['client.client_name', 'client_name'],
    contact_name: ['contact_name'],
    vendor_name: ['vendor_name', 'vendor_id'],
    billing_profile_name: ['billing_profile_name', 'billing_profile_id'],
  };
  for (const [alias, sources] of Object.entries(aliases)) {
    if (sources.some((source) => paths.has(source))) delete projected[alias];
  }
  return projected as T;
}
