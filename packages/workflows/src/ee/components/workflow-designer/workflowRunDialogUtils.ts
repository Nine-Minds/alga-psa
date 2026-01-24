type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

export type EventCatalogEntryLite = {
  event_type: string;
  name: string;
  description?: string | null;
  category?: string | null;
  tenant?: string | null;
};

export type SchemaDiffSummary = {
  onlyInEvent: string[];
  onlyInPayload: string[];
  requiredOnlyInEvent: string[];
  requiredOnlyInPayload: string[];
  typeMismatches: Array<{ field: string; eventType?: string; payloadType?: string }>;
};

const normalizeType = (schema?: JsonSchema | null) => {
  if (!schema?.type) return undefined;
  return Array.isArray(schema.type) ? schema.type[0] : schema.type;
};

export const filterEventCatalogEntries = (
  entries: EventCatalogEntryLite[],
  search: string
) => {
  const term = search.trim().toLowerCase();
  if (!term) return entries;
  return entries.filter((entry) => (
    entry.event_type.toLowerCase().includes(term)
    || entry.name.toLowerCase().includes(term)
    || (entry.category ?? '').toLowerCase().includes(term)
    || (entry.description ?? '').toLowerCase().includes(term)
  ));
};

export const getSchemaDiffSummary = (
  payloadSchema?: JsonSchema | null,
  eventSchema?: JsonSchema | null
): SchemaDiffSummary | null => {
  if (!payloadSchema || !eventSchema) return null;
  const payloadProps = payloadSchema.properties ?? {};
  const eventProps = eventSchema.properties ?? {};

  const payloadKeys = new Set(Object.keys(payloadProps));
  const eventKeys = new Set(Object.keys(eventProps));

  const onlyInEvent = Array.from(eventKeys).filter((key) => !payloadKeys.has(key));
  const onlyInPayload = Array.from(payloadKeys).filter((key) => !eventKeys.has(key));

  const payloadRequired = new Set(payloadSchema.required ?? []);
  const eventRequired = new Set(eventSchema.required ?? []);

  const requiredOnlyInEvent = Array.from(eventRequired).filter((key) => !payloadRequired.has(key));
  const requiredOnlyInPayload = Array.from(payloadRequired).filter((key) => !eventRequired.has(key));

  const typeMismatches = Array.from(payloadKeys).reduce<SchemaDiffSummary['typeMismatches']>((acc, key) => {
    if (!eventKeys.has(key)) return acc;
    const payloadType = normalizeType(payloadProps[key]);
    const eventType = normalizeType(eventProps[key]);
    if (payloadType && eventType && payloadType !== eventType) {
      acc.push({ field: key, payloadType, eventType });
    }
    return acc;
  }, []);

  return {
    onlyInEvent,
    onlyInPayload,
    requiredOnlyInEvent,
    requiredOnlyInPayload,
    typeMismatches
  };
};

export const pickEventTemplates = (params: {
  eventType?: string | null;
  category?: string | null;
}) => {
  const eventType = params.eventType ?? '';
  const category = params.category ?? '';
  const haystack = `${eventType} ${category}`.toLowerCase();
  const templates: string[] = [];

  if (haystack.includes('email')) {
    templates.push('email');
  }
  if (haystack.includes('webhook')) {
    templates.push('webhook');
  }

  return templates;
};
