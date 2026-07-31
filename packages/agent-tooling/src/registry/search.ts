import { ChatApiRegistryEntry } from './schema';

const PLACEHOLDER_DESCRIPTION =
  'This operation was generated automatically from the route inventory. Replace with canonical OpenAPI metadata.';

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'for',
  'of',
  'in',
  'on',
  'at',
  'by',
  'with',
  'and',
  'or',
  'from',
  'api',
  'v1',
]);

const IRREGULAR_SINGULARS: Record<string, string> = {
  phases: 'phase',
  statuses: 'status',
};

type SearchIntent = 'create' | 'update' | 'delete' | 'list' | 'detail';

type SearchContext = {
  normalizedQuery: string;
  tokens: string[];
  intents: Set<SearchIntent>;
  mentionsIdLookup: boolean;
  mentionsList: boolean;
};

export interface RegistrySearchResult {
  entry: ChatApiRegistryEntry;
  score: number;
  matchedFields: string[];
}

function singularize(token: string) {
  if (token in IRREGULAR_SINGULARS) {
    return IRREGULAR_SINGULARS[token];
  }
  if (token.endsWith('ies') && token.length > 3) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith('ses') && token.length > 3) {
    return token.slice(0, -2);
  }
  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function tokenize(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => singularize(token.trim()))
        .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
    ),
  );
}

// Singularize every word in a block of text while leaving separators intact.
// Query tokens are singularized (e.g. "priorities" -> "priority"), so matching a
// singularized view of the field text keeps substring matching symmetric for
// irregular plurals whose singular is not a substring of the plural — "priorities",
// "categories", "companies". Input is expected to already be lower-cased.
function singularizeText(text: string) {
  return text.replace(/[a-z0-9]+/g, (word) => singularize(word));
}

function buildSearchContext(query: string): SearchContext {
  const normalizedQuery = query.trim().toLowerCase();
  const intents = new Set<SearchIntent>();

  if (/\b(create|add|new|open)\b/.test(normalizedQuery)) {
    intents.add('create');
  }
  if (/\b(update|edit|change|set|mark|assign|move|rename)\b/.test(normalizedQuery)) {
    intents.add('update');
  }
  if (/\b(delete|remove|cancel|archive)\b/.test(normalizedQuery)) {
    intents.add('delete');
  }
  if (/\b(list|search|find|all|recent|latest|show)\b/.test(normalizedQuery)) {
    intents.add('list');
  }
  if (/\b(by id|id|details?|detail|single|view|get)\b/.test(normalizedQuery)) {
    intents.add('detail');
  }

  return {
    normalizedQuery,
    tokens: tokenize(normalizedQuery),
    intents,
    mentionsIdLookup: /\b(by id|id|details?|detail|single)\b/.test(normalizedQuery),
    mentionsList: /\b(list|search|find|all|recent|latest)\b/.test(normalizedQuery),
  };
}

function derivePathTokens(pathName: string) {
  return tokenize(pathName.replace(/[{}]/g, ' '));
}

function deriveResourceSegments(pathName: string) {
  const segments = pathName
    .split('/')
    .filter(Boolean)
    .filter((segment) => !segment.startsWith('{') && !/^v\d+$/i.test(segment) && segment !== 'api')
    .map((segment) => singularize(segment.toLowerCase()));

  return segments;
}

function hasPlaceholderMetadata(entry: ChatApiRegistryEntry) {
  const genericLabelPattern = /^(get|post|put|patch|delete)\s+v\d+$/i;
  return (
    genericLabelPattern.test(entry.displayName.trim()) ||
    genericLabelPattern.test(entry.summary?.trim() ?? '') ||
    entry.description?.trim() === PLACEHOLDER_DESCRIPTION
  );
}

function hasStructuredRequestSchema(entry: ChatApiRegistryEntry) {
  if (!entry.requestBodySchema || typeof entry.requestBodySchema !== 'object') {
    return false;
  }

  if (Array.isArray(entry.requestBodySchema)) {
    return entry.requestBodySchema.length > 0;
  }

  const schema = entry.requestBodySchema as Record<string, unknown>;
  const properties = schema.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    return Object.keys(properties as Record<string, unknown>).length > 0;
  }

  return Object.keys(schema).length > 0;
}

function scoreIntent(entry: ChatApiRegistryEntry, context: SearchContext) {
  const hasPathParams = /\{[^}]+\}/.test(entry.path);
  const isGetById = entry.method === 'get' && /\{id\}/.test(entry.path);
  const isListEndpoint = entry.method === 'get' && !hasPathParams;
  const hasMutatingIntent =
    context.intents.has('create') ||
    context.intents.has('update') ||
    context.intents.has('delete');

  let score = 0;

  if (context.intents.has('create')) {
    score += entry.method === 'post' ? 14 : 0;
  }
  if (context.intents.has('update')) {
    score += entry.method === 'put' || entry.method === 'patch' ? 12 : 0;
  }
  if (context.intents.has('delete')) {
    score += entry.method === 'delete' ? 14 : 0;
  }
  if (context.intents.has('list')) {
    score += isListEndpoint ? 6 : entry.method === 'get' ? 1 : 0;
  }
  if (context.intents.has('detail')) {
    score += isGetById ? 6 : entry.method === 'get' && hasPathParams ? 2 : 0;
  }
  if (context.mentionsIdLookup && isGetById) {
    score += 3;
  }
  if (context.mentionsList && isListEndpoint) {
    score += 3;
  }
  if (!context.intents.has('detail') && isGetById) {
    score -= 3;
  }
  if (!context.intents.has('detail') && entry.method === 'get' && hasPathParams) {
    score -= 1;
  }
  if (hasMutatingIntent && entry.method === 'get') {
    score -= 6;
  }

  return score;
}

function scoreTokenMatches(
  entry: ChatApiRegistryEntry,
  context: SearchContext,
  matchedFields: Set<string>,
) {
  const joinedParameters = entry.parameters
    .map((param) => `${param.name} ${param.in} ${param.description ?? ''}`)
    .join(' ')
    .toLowerCase();
  const joinedPlaybooks = (entry.playbooks ?? []).join(' ').toLowerCase();
  const fieldTexts: Array<[string, string, number]> = [
    ['displayName', entry.displayName.toLowerCase(), 3],
    ['summary', (entry.summary ?? '').toLowerCase(), 2.5],
    ['description', (entry.description ?? '').toLowerCase(), 1.5],
    ['path', entry.path.toLowerCase(), 3],
    ['tags', entry.tags.join(' ').toLowerCase(), 2.5],
    ['parameters', joinedParameters, 1.5],
    ['playbooks', joinedPlaybooks, 1],
  ];

  let score = 0;
  for (const [field, value, weight] of fieldTexts) {
    // Match against the raw field text and a singularized view of it so a query
    // token like "priority" (singularized from "priorities") still matches a field
    // that literally reads "priorities". Computed once per field, not per token.
    const singularValue = singularizeText(value);
    for (const token of context.tokens) {
      if (value.includes(token) || singularValue.includes(token)) {
        score += weight;
        matchedFields.add(field);
      }
    }
  }

  return score;
}

function scoreEntry(
  entry: ChatApiRegistryEntry,
  context: SearchContext,
  index: number,
): RegistrySearchResult {
  const matchedFields = new Set<string>();
  const pathTokens = derivePathTokens(entry.path);
  const tagTokens = tokenize(entry.tags.join(' '));
  const resourceSegments = deriveResourceSegments(entry.path);
  const matchingResourceTokens = context.tokens.filter(
    (token) => pathTokens.includes(token) || tagTokens.includes(token),
  );
  const lastResourceSegment = resourceSegments[resourceSegments.length - 1];

  let score = 0;
  score += scoreTokenMatches(entry, context, matchedFields);
  score += scoreIntent(entry, context);
  score += matchingResourceTokens.length * 2;

  if (matchingResourceTokens.length > 0) {
    matchedFields.add('resource');
  }

  if (
    lastResourceSegment &&
    context.tokens.includes(lastResourceSegment) &&
    ((context.intents.has('create') && entry.method === 'post') ||
      (context.intents.has('update') &&
        (entry.method === 'put' || entry.method === 'patch')) ||
      (context.intents.has('delete') && entry.method === 'delete'))
  ) {
    score += 4;
    matchedFields.add('resourceTail');
  }

  // Exact-resource match: every resource segment of the path is named in the query.
  // This favors the endpoint whose whole resource the user asked for (POST /tickets
  // for "create ticket") over one where the noun is only a trailing qualifier
  // (POST /categories/ticket — a ticket *category*). The bonus applies equally to
  // all of a resource's endpoints, so it never disturbs intra-resource ordering.
  if (
    resourceSegments.length > 0 &&
    resourceSegments.every((segment) => context.tokens.includes(segment))
  ) {
    score += 4;
    matchedFields.add('resourceExact');
  }

  if (
    (context.intents.has('create') || context.intents.has('update')) &&
    hasStructuredRequestSchema(entry)
  ) {
    score += 2;
    matchedFields.add('requestBodySchema');
  }

  if (hasPlaceholderMetadata(entry)) {
    score -= context.intents.size > 0 ? 3 : 1;
  }

  score += Math.max(0, 2 - index * 0.05);

  return {
    entry,
    score,
    matchedFields: Array.from(matchedFields),
  };
}

export function searchRegistryEntries(
  registry: ChatApiRegistryEntry[],
  query: string,
  limit = 5,
): RegistrySearchResult[] {
  const context = buildSearchContext(query);
  if (!context.normalizedQuery) {
    return [];
  }

  return registry
    .map((entry, index) => scoreEntry(entry, context, index))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
