export const KNOWN_PROVIDER_CAPABILITIES = [
  'cap:context.read',
  'cap:secrets.get',
  'cap:http.fetch',
  'cap:storage.kv',
  'cap:log.emit',
  'cap:ui.proxy',
] as const;

export const DEFAULT_PROVIDER_CAPABILITIES = ['cap:context.read', 'cap:log.emit'] as const;

export type ProviderCapability = (typeof KNOWN_PROVIDER_CAPABILITIES)[number];

const NORMALIZED_CAPABILITY_SET = new Set(
  KNOWN_PROVIDER_CAPABILITIES.map((cap) => cap.trim().toLowerCase())
);

export function normalizeCapability(capability: string): string {
  return capability.trim().toLowerCase();
}

export function isKnownCapability(capability: string): boolean {
  return NORMALIZED_CAPABILITY_SET.has(normalizeCapability(capability));
}

export function coerceProviders(values: unknown): string[] {
  if (!values) return [];
  let arr: unknown[] = [];
  if (Array.isArray(values)) {
    arr = values;
  } else if (typeof values === 'string') {
    try {
      const parsed = JSON.parse(values);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      // ignore
    }
  }
  return arr
    .map((value) => (typeof value === 'string' ? normalizeCapability(value) : undefined))
    .filter((value): value is string => Boolean(value) && isKnownCapability(value!));
}

export function withDefaultProviders(values: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const value of values) {
    const normalized = normalizeCapability(value);
    if (isKnownCapability(normalized)) {
      set.add(normalized);
    }
  }
  for (const cap of DEFAULT_PROVIDER_CAPABILITIES) {
    set.add(normalizeCapability(cap));
  }
  return Array.from(set);
}
