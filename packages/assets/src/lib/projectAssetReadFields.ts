/** Remove policy-redacted paths from an asset and its nested response values. */
export function projectAssetReadFields<T>(value: T, redactedFields: readonly string[] = []): T {
  const mask = createAssetReadFieldMask(redactedFields);
  const paths = mask.paths;
  const pathsOverlap = (left: string, right: string) =>
    left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
  const historyPathIsMasked = (path: string) => {
    const assetPath = path.startsWith('changes.') ? path.slice('changes.'.length) : path;
    const segments = assetPath.split('.');
    return [...paths].some((redactedPath) => segments.some((_, index) => {
      // Wrappers such as `fields` and `maintenance_data` are not asset path
      // segments. Compare every suffix so full asset paths still match.
      return pathStartsWithMask(segments.slice(index), redactedPath.split('.'));
    }));
  };

  const project = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item, index) => project(item, `${path}.${index}`));
    if (!node || typeof node !== 'object') return node;
    const prototype = Object.getPrototypeOf(node);
    if (prototype !== Object.prototype && prototype !== null) return node;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      // History stores asset values below a `changes`/`fields` wrapper. Match
      // asset paths at any depth there, and also support flattened dotted keys.
      const isHistoryValue = path === 'changes' || path.startsWith('changes.');
      const historyFieldMatch = isHistoryValue && historyPathIsMasked(childPath);
      const directFieldMatch = [...paths].some((redactedPath) =>
        pathMatchesExactly(childPath.split('.'), redactedPath.split('.'))
      );
      if (directFieldMatch || historyFieldMatch) continue;
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

const ASSET_READ_FIELD_ALIASES = [
  ['contact_name_id', 'contact_name'],
  ['client.client_name', 'client_name'],
  ['client_id', 'client.client_id'],
  ['vendor_id', 'vendor_name'],
  ['billing_profile_id', 'billing_profile_name'],
  ['name', 'maintenanceReport.asset_name'],
] as const;

/** The shared path interpretation used by read projection and safe mutations. */
export function createAssetReadFieldMask(redactedFields: readonly string[] = []) {
  const paths = new Set(redactedFields.map((field) => field.replace(/^assets?\./, '').replace(/^asset\./, '')));
  const overlaps = (left: string, right: string) =>
    left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
  const isMasked = (field: string) => [...paths].some((path) => overlaps(field, path));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const group of ASSET_READ_FIELD_ALIASES) {
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
  return { paths, isMasked };
}

/** Remove every redacted path before update validation or normalization. */
export function removeAssetReadMaskedFields<T>(value: T, redactedFields: readonly string[] = []): T {
  const mask = createAssetReadFieldMask(redactedFields);
  const masksPath = (path: string) => [...mask.paths].some((redactedPath) =>
    pathStartsWithMask(path.split('.'), redactedPath.split('.'))
  );
  const visit = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item, index) => visit(item, `${path}.${index}`));
    if (!node || typeof node !== 'object') return node;
    const prototype = Object.getPrototypeOf(node);
    if (prototype !== Object.prototype && prototype !== null) return node;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (masksPath(childPath)) continue;
      result[key] = visit(child, childPath);
    }
    return result;
  };
  return visit(value, '') as T;
}

function pathStartsWithMask(path: readonly string[], mask: readonly string[]): boolean {
  let pathIndex = 0;
  let maskIndex = 0;
  while (maskIndex < mask.length) {
    if (pathIndex >= path.length) return false;
    if (/^\d+$/.test(path[pathIndex]) && !/^\d+$/.test(mask[maskIndex])) {
      pathIndex += 1;
      continue;
    }
    if (path[pathIndex] !== mask[maskIndex]) return false;
    pathIndex += 1;
    maskIndex += 1;
  }
  return true;
}

function pathMatchesExactly(path: readonly string[], mask: readonly string[]): boolean {
  let pathIndex = 0;
  let maskIndex = 0;
  while (pathIndex < path.length && maskIndex < mask.length) {
    if (/^\d+$/.test(path[pathIndex]) && !/^\d+$/.test(mask[maskIndex])) {
      pathIndex += 1;
      continue;
    }
    if (path[pathIndex] !== mask[maskIndex]) return false;
    pathIndex += 1;
    maskIndex += 1;
  }
  return pathIndex === path.length && maskIndex === mask.length;
}

/**
 * Restore redacted descendants into JSON values that the caller is replacing.
 * Asset attributes merge one top-level key at a time; extension JSON columns
 * replace the whole column. The caller passes the trusted pre-update asset.
 */
export function restoreAssetReadMaskedDescendants<T>(
  candidate: T,
  storedAsset: unknown,
  redactedFields: readonly string[] = []
): T {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
    || !storedAsset || typeof storedAsset !== 'object' || Array.isArray(storedAsset)) return candidate;

  const candidateRoot = { ...(candidate as Record<string, unknown>) };
  const storedRoot = storedAsset as Record<string, unknown>;
  const mask = createAssetReadFieldMask(redactedFields);
  const extensionTypes = new Set(['workstation', 'network_device', 'server', 'mobile_device', 'printer']);
  const groups = new Map<string, { root: string; key: string; paths: string[][] }>();

  for (const path of mask.paths) {
    const segments = path.split('.');
    const root = segments[0];
    if (root !== 'attributes' && !extensionTypes.has(root)) continue;
    if (segments.length < 3) continue;
    const key = segments[1];
    const groupId = `${root}.${key}`;
    const group = groups.get(groupId) ?? { root, key, paths: [] };
    group.paths.push(segments.slice(2));
    groups.set(groupId, group);
  }

  for (const group of groups.values()) {
    const candidateContainer = candidateRoot[group.root];
    const storedContainer = storedRoot[group.root];
    if (!isPlainRecord(candidateContainer) || !isPlainRecord(storedContainer)) continue;
    if (!Object.prototype.hasOwnProperty.call(candidateContainer, group.key)) continue;
    const existing = storedContainer[group.key];
    const applicablePaths = group.paths.filter((path) => hasPath(existing, path));
    if (applicablePaths.length === 0) continue;
    const nextContainer = { ...candidateContainer };
    nextContainer[group.key] = restore(existing, candidateContainer[group.key], applicablePaths);
    candidateRoot[group.root] = nextContainer;
  }

  return candidateRoot as T;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasPath(value: unknown, path: readonly string[]): boolean {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment) || !Object.prototype.hasOwnProperty.call(current, Number(segment))) return false;
      current = current[Number(segment)];
    } else if (isPlainRecord(current) && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment];
    } else {
      return false;
    }
  }
  return true;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]));
  return value;
}

function restore(current: unknown, incoming: unknown, paths: readonly string[][]): unknown {
  if (paths.some((path) => path.length === 0)) return cloneJsonValue(current);

  if (Array.isArray(current)) {
    // Index-based masks are stable only while the array shape is stable. A
    // replacement or reorder with a different length preserves the old array.
    if (!Array.isArray(incoming) || incoming.length !== current.length) return cloneJsonValue(current);
    const result = incoming.map(cloneJsonValue);
    const byIndex = new Map<number, string[][]>();
    for (const path of paths) {
      if (!/^\d+$/.test(path[0])) return cloneJsonValue(current);
      const index = Number(path[0]);
      const remaining = byIndex.get(index) ?? [];
      remaining.push(path.slice(1));
      byIndex.set(index, remaining);
    }
    for (const [index, remaining] of byIndex) {
      result[index] = restore(current[index], incoming[index], remaining);
    }
    return result;
  }

  if (!isPlainRecord(current)) return cloneJsonValue(incoming);
  if (incoming !== undefined && !isPlainRecord(incoming)) return cloneJsonValue(current);
  const incomingRecord = isPlainRecord(incoming) ? incoming : {};
  const result: Record<string, unknown> = { ...incomingRecord };
  const byKey = new Map<string, string[][]>();
  for (const path of paths) {
    const remaining = byKey.get(path[0]) ?? [];
    remaining.push(path.slice(1));
    byKey.set(path[0], remaining);
  }
  for (const [key, remaining] of byKey) {
    result[key] = restore(current[key], incomingRecord[key], remaining);
  }
  return result;
}
