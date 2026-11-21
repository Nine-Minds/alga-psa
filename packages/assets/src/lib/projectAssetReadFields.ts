/** Remove policy-redacted paths from an asset and its nested response values. */
export function projectAssetReadFields<T>(value: T, redactedFields: readonly string[] = []): T {
  const mask = createAssetReadFieldMask(redactedFields);
  const paths = mask.paths;
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
    if (Array.isArray(node)) return node.map((item, index) => {
      const itemPath = `${path}.${index}`;
      // A null placeholder conceals the element without shifting numeric masks.
      const historyElementMasked = (path === 'changes' || path.startsWith('changes.'))
        && historyPathIsMasked(itemPath);
      return isPathMasked(itemPath, paths) || historyElementMasked ? null : project(item, itemPath);
    });
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
      if (isPathMasked(childPath, paths) || historyFieldMatch) continue;
      if (isHistoryValue && (key === 'before' || key === 'after' || key === 'previous_value' || key === 'new_value' || key === 'old_value' || key === 'value')) {
        const field = (node as Record<string, unknown>).field ?? (node as Record<string, unknown>).field_name ?? (node as Record<string, unknown>).path;
        if (typeof field === 'string' && mask.isMasked(field)) continue;
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
  const paths = new Set(redactedFields.map(normalizeAssetFieldPath));
  // Ancestor values and positional containers also intersect a descendant
  // mask. Use the same indexed/implicit-array semantics as leaf projection.
  const isMasked = (field: string) => {
    const segments = normalizeAssetFieldPath(field).split('.');
    return [...paths].some((path) => pathsOverlap(segments, path.split('.')));
  };
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

function normalizeAssetFieldPath(field: string): string {
  return field.replace(/^assets?\./, '').replace(/^asset\./, '');
}

/** Remove every redacted path before update validation or normalization. */
export function removeAssetReadMaskedFields<T>(value: T, redactedFields: readonly string[] = []): T {
  const mask = createAssetReadFieldMask(redactedFields);
  const visit = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item, index) => {
      const itemPath = `${path}.${index}`;
      return isPathMasked(itemPath, mask.paths) ? null : visit(item, itemPath);
    });
    if (!node || typeof node !== 'object') return node;
    const prototype = Object.getPrototypeOf(node);
    if (prototype !== Object.prototype && prototype !== null) return node;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isPathMasked(childPath, mask.paths)) continue;
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

function pathsOverlap(left: readonly string[], right: readonly string[]): boolean {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
    } else if (/^\d+$/.test(left[leftIndex]) && !/^\d+$/.test(right[rightIndex])) {
      leftIndex += 1;
    } else if (/^\d+$/.test(right[rightIndex]) && !/^\d+$/.test(left[leftIndex])) {
      rightIndex += 1;
    } else {
      return false;
    }
  }
  return true;
}

/** True when a path reaches or descends from a redacted path. */
function isPathMasked(path: string, masks: ReadonlySet<string>): boolean {
  const segments = path.split('.');
  return [...masks].some((mask) => pathStartsWithMask(segments, mask.split('.')));
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
    if (!group.paths.some((path) => hasPath(existing, path))) continue;
    const nextContainer = { ...candidateContainer };
    nextContainer[group.key] = restore(existing, candidateContainer[group.key], group.paths);
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
  if (path.length === 0) return true;
  const [segment, ...remaining] = path;
  if (Array.isArray(value)) {
    if (/^\d+$/.test(segment)) {
      const index = Number(segment);
      return Object.prototype.hasOwnProperty.call(value, index) && hasPath(value[index], remaining);
    }
    return value.some((item) => hasPath(item, path));
  }
  if (isPlainRecord(value) && Object.prototype.hasOwnProperty.call(value, segment)) {
    return hasPath(value[segment], remaining);
  }
  return false;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]));
  return value;
}

function restore(current: unknown, incoming: unknown, paths: readonly string[][]): unknown {
  const existingPaths = paths.filter((path) => hasPath(current, path));
  if (existingPaths.length === 0) return cloneJsonValue(incoming);
  if (existingPaths.some((path) => path.length === 0)) return cloneJsonValue(current);

  if (Array.isArray(current)) {
    // Index-based masks are stable only while the array shape is stable. A
    // replacement or reorder with a different length preserves the old array.
    if (!Array.isArray(incoming) || incoming.length !== current.length) return cloneJsonValue(current);
    const result = incoming.map(cloneJsonValue);
    const byIndex = new Map<number, string[][]>();
    const implicitPaths: string[][] = [];
    for (const path of existingPaths) {
      if (/^\d+$/.test(path[0])) {
        const index = Number(path[0]);
        const remaining = byIndex.get(index) ?? [];
        remaining.push(path.slice(1));
        byIndex.set(index, remaining);
      } else {
        implicitPaths.push(path);
      }
    }
    for (let index = 0; index < current.length; index += 1) {
      const itemPaths = [...(byIndex.get(index) ?? []), ...implicitPaths];
      if (itemPaths.length > 0) result[index] = restore(current[index], incoming[index], itemPaths);
    }
    return result;
  }

  if (!isPlainRecord(current)) return cloneJsonValue(incoming);
  if (incoming !== undefined && !isPlainRecord(incoming)) return cloneJsonValue(current);
  const incomingRecord = isPlainRecord(incoming) ? incoming : {};
  const result: Record<string, unknown> = { ...incomingRecord };
  const byKey = new Map<string, string[][]>();
  for (const path of existingPaths) {
    const remaining = byKey.get(path[0]) ?? [];
    remaining.push(path.slice(1));
    byKey.set(path[0], remaining);
  }
  for (const [key, remaining] of byKey) {
    result[key] = restore(current[key], incomingRecord[key], remaining);
  }
  return result;
}
