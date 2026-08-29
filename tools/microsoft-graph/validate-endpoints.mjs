#!/usr/bin/env node
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolDir, '../..');
const config = JSON.parse(readFileSync(join(toolDir, 'endpoints.json'), 'utf8'));
const MS_PER_DAY = 86_400_000;
const VERSIONS = ['v1.0', 'beta'];

function attrs(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function stripCollection(type) {
  const match = /^Collection\((.+)\)$/.exec(type || '');
  return { type: match ? match[1] : type, collection: Boolean(match) };
}

export function parseCsdl(xml) {
  const types = new Map();
  const roots = new Map();
  const operations = [];
  const aliases = new Map([...xml.matchAll(/<Schema\b([^>]*)>/g)].map((match) => {
    const schema = attrs(match[1]);
    return [schema.Alias, schema.Namespace];
  }).filter(([alias, namespace]) => alias && namespace));
  const normalizeType = (type) => {
    const parsed = stripCollection(type);
    const dot = parsed.type?.indexOf('.') ?? -1;
    const prefix = dot > 0 ? parsed.type.slice(0, dot) : '';
    const normalized = aliases.has(prefix) ? `${aliases.get(prefix)}${parsed.type.slice(dot)}` : parsed.type;
    return parsed.collection ? `Collection(${normalized})` : normalized;
  };

  for (const schemaMatch of xml.matchAll(/<Schema\b([^>]*)>([\s\S]*?)<\/Schema>/g)) {
    const schemaAttrs = attrs(schemaMatch[1]);
    const namespace = schemaAttrs.Namespace;
    const body = schemaMatch[2];
    if (!namespace) continue;

    for (const typeMatch of body.matchAll(/<(EntityType|ComplexType)\b(?![^>]*\/>)([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const typeAttrs = attrs(typeMatch[2]);
      const fullName = `${namespace}.${typeAttrs.Name}`;
      const properties = new Map();
      for (const propertyMatch of typeMatch[3].matchAll(/<(Property|NavigationProperty)\b([^>]*?)(?:\/>|>)/g)) {
        const propertyAttrs = attrs(propertyMatch[2]);
        if (propertyAttrs.Name && propertyAttrs.Type) properties.set(propertyAttrs.Name, propertyAttrs.Type);
      }
      types.set(fullName, {
        base: typeAttrs.BaseType ? normalizeType(typeAttrs.BaseType) : null,
        properties: new Map([...properties].map(([name, type]) => [name, normalizeType(type)])),
      });
    }
    for (const typeMatch of body.matchAll(/<(EntityType|ComplexType)\b([^>]*)\/>/g)) {
      const typeAttrs = attrs(typeMatch[2]);
      types.set(`${namespace}.${typeAttrs.Name}`, {
        base: typeAttrs.BaseType ? normalizeType(typeAttrs.BaseType) : null,
        properties: new Map(),
      });
    }

    for (const containerMatch of body.matchAll(/<EntityContainer\b[^>]*>([\s\S]*?)<\/EntityContainer>/g)) {
      for (const rootMatch of containerMatch[1].matchAll(/<(EntitySet|Singleton)\b([^>]*?)(?:\/>|>)/g)) {
        const rootAttrs = attrs(rootMatch[2]);
        const type = rootAttrs.EntityType || rootAttrs.Type;
        if (rootAttrs.Name && type) roots.set(rootAttrs.Name, normalizeType(rootMatch[1] === 'EntitySet' ? `Collection(${type})` : type));
      }
    }

    for (const operationMatch of body.matchAll(/<(Action|Function)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const operationAttrs = attrs(operationMatch[2]);
      if (operationAttrs.IsBound !== 'true') continue;
      const parameters = [...operationMatch[3].matchAll(/<Parameter\b([^>]*?)(?:\/>|>)/g)].map((match) => attrs(match[1]));
      if (!parameters[0]?.Type) continue;
      const returnMatch = /<ReturnType\b([^>]*?)(?:\/>|>)/.exec(operationMatch[3]);
      operations.push({
        kind: operationMatch[1],
        name: operationAttrs.Name,
        bindingType: normalizeType(parameters[0].Type),
        returnType: returnMatch ? normalizeType(attrs(returnMatch[1]).Type) : null,
      });
    }
  }

  return { types, roots, operations };
}

function findProperty(model, typeName, propertyName) {
  let current = typeName;
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    const definition = model.types.get(current);
    if (!definition) return null;
    if (definition.properties.has(propertyName)) return definition.properties.get(propertyName);
    current = definition.base;
  }
  return null;
}

function inheritsFrom(model, actual, expected) {
  let current = actual;
  const visited = new Set();
  while (current && !visited.has(current)) {
    if (current === expected) return true;
    visited.add(current);
    current = model.types.get(current)?.base || null;
  }
  return false;
}

function bindingMatches(model, actualType, bindingType) {
  const actual = stripCollection(actualType);
  const expected = stripCollection(bindingType);
  return actual.collection === expected.collection && inheritsFrom(model, actual.type, expected.type);
}

export function validatePath(model, pathTemplate, method) {
  const segments = pathTemplate.split('?')[0].split('/').filter(Boolean);
  const root = segments.shift();
  if (!root || !model.roots.has(root)) return `unknown root '${root || ''}'`;
  let currentType = model.roots.get(root);
  let previousSegment = root;

  for (const segment of segments) {
    if (/^\{[^}]+\}$/.test(segment)) {
      const unwrapped = stripCollection(currentType);
      if (!unwrapped.collection) return `key segment ${segment} follows non-collection ${currentType}`;
      currentType = unwrapped.type;
      previousSegment = segment;
      continue;
    }
    if (segment === '$value') {
      const current = stripCollection(currentType);
      if (!current.collection && (current.type === 'Edm.Stream' || inheritsFrom(model, current.type, 'microsoft.graph.message'))) return null;
      return `$value is not available on ${currentType}`;
    }

    const current = stripCollection(currentType);
    const propertyType = findProperty(model, current.type, segment);
    if (propertyType) {
      currentType = propertyType;
      previousSegment = segment;
      continue;
    }

    const candidates = model.operations.filter((operation) =>
      operation.name === segment && bindingMatches(model, currentType, operation.bindingType));
    if (candidates.length) {
      // Graph publishes event delta only at calendarView/delta. The CSDL's
      // Collection(event)-bound function alone is broader than Graph's routing
      // surface and would otherwise incorrectly bless events/delta.
      if (segment === 'delta' && stripCollection(currentType).type === 'microsoft.graph.event' && previousSegment !== 'calendarView') {
        return "segment 'delta' is not published for events; use calendarView/delta";
      }
      const methodCandidates = method
        ? candidates.filter((candidate) => method === (candidate.kind === 'Action' ? 'POST' : 'GET'))
        : candidates;
      if (!methodCandidates.length) return `${candidates[0].kind.toLowerCase()} '${segment}' does not support ${method}`;
      currentType = methodCandidates.find((candidate) => candidate.returnType)?.returnType || 'Edm.Untyped';
      previousSegment = segment;
      continue;
    }
    return `segment '${segment}' does not exist on ${currentType}`;
  }
  return null;
}

function canonicalPath(path) {
  return path
    .replace(/\$\{[^}]+\}/g, '{id}')
    .split('?')[0]
    .replace(/:[A-Za-z][A-Za-z0-9_]*/g, '{id}')
    .replace(/\{[^}]+\}/g, '{id}')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function key(version, method, path) {
  return `${version} ${method.toUpperCase()} ${canonicalPath(path)}`;
}

function walkFiles(root, output = []) {
  for (const name of readdirSync(root)) {
    if (['.git', '.next', 'node_modules', 'dist', 'build', 'coverage'].includes(name)) continue;
    const path = join(root, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) walkFiles(path, output);
    else if (/\.(?:[cm]?[jt]sx?)$/.test(name) && !/\.(?:test|spec)\./.test(name)) output.push(path);
  }
  return output;
}

function methodNear(source, index) {
  const before = source.slice(Math.max(0, index - 100), index);
  const axios = /\.(get|post|patch|delete|put)\s*\([^()]*$/i.exec(before);
  if (axios) return axios[1].toUpperCase();
  const after = source.slice(index, index + 500);
  const explicit = /method\s*:\s*['"](GET|POST|PATCH|DELETE|PUT)['"]/i.exec(after);
  if (explicit) return explicit[1].toUpperCase();
  const laterCall = /\.(get|post|patch|delete|put)\s*\(/i.exec(after);
  if (laterCall) return laterCall[1].toUpperCase();
  return 'GET';
}

export function discoverSourceCalls() {
  const calls = [];
  const addExpression = ({ version = 'v1.0', method, expression, file }) => {
    const variants = expression.includes('${mailboxBase}') || expression.includes('${this.getMailboxBasePath()}')
      ? ['/me', '/users/{userId}'].map((root) => expression
          .replace('${mailboxBase}', root)
          .replace('${this.getMailboxBasePath()}', root))
      : [expression.replace('${calendarBase}', '/me/calendar')];
    for (const path of variants) calls.push({ version, method, path, file });
  };
  const roots = ['shared', 'packages', 'server', 'ee', 'scripts'];
  for (const root of roots) {
    for (const file of walkFiles(join(repoRoot, root))) {
      const source = readFileSync(file, 'utf8');
      const rel = relative(repoRoot, file);

      for (const match of source.matchAll(/https:\/\/graph\.microsoft\.com\/(v1\.0|beta)(\/[^`'"\n]*)/g)) {
        if (!match[2].startsWith('/')) continue;
        const raw = match[2].split(/[`'"\n]/)[0];
        calls.push({ version: match[1], method: methodNear(source, match.index), path: raw, file: rel });
      }

      const builderPatterns = [
        { regex: /\$\{getMicrosoftGraphBaseUrl\(\)\}([^`]+)/g, version: 'v1.0' },
        { regex: /\$\{getMicrosoftGraphBetaBaseUrl\(\)\}([^`]+)/g, version: 'beta' },
        { regex: /\$\{graphBaseUrl\(\)\}([^`]+)/g, version: 'v1.0' },
        { regex: /\$\{graphBetaBaseUrl\(\)\}([^`]+)/g, version: 'beta' },
      ];
      for (const pattern of builderPatterns) {
        for (const match of source.matchAll(pattern.regex)) {
          calls.push({ version: pattern.version, method: methodNear(source, match.index), path: match[1], file: rel });
        }
      }

      if (/graph\.microsoft\.com\/v1\.0|getMicrosoftGraphBaseUrl|DEFAULT_MICROSOFT_GRAPH_BASE_URL/.test(source)) {
        for (const match of source.matchAll(/this\.httpClient\.(get|post|patch|delete|put)\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g)) {
          addExpression({
            method: match[1].toUpperCase(),
            expression: match[2] || match[3] || match[4],
            file: rel,
          });
        }

        for (const match of source.matchAll(/graphRequest(?:<[^>]+>)?\(\s*\{([\s\S]*?)\}\s*\)/g)) {
          const object = match[1];
          const methodMatch = /method\s*:\s*['"](GET|POST|PATCH|DELETE|PUT)['"]/.exec(object);
          const pathMatch = /path\s*:\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/.exec(object);
          if (methodMatch && pathMatch) {
            addExpression({ method: methodMatch[1], expression: pathMatch[1] || pathMatch[2] || pathMatch[3], file: rel });
          }
        }
      }
    }
  }
  return calls.filter((call) => call.path.startsWith('/') && !call.path.includes('${params.path}'));
}

// Emulator route templates interpolate build-time literals, never ids. Leaving
// one for canonicalPath to fold into {id} invents a key segment: it either
// fails against a single-valued entity or, worse, silently blesses fiction.
// Expand them from the loops that produce them and refuse to guess at the rest.
const PACKAGED_ROUTE_LITERALS = [
  {
    token: '${root}',
    variable: 'root',
    values: ['/me', '/users/:userId'],
    bindings: ['for (const root of mailboxRoots)'],
    markers: ["const mailboxRoots = ['/me', '/users/:userId'];"],
  },
  {
    token: '${segment}',
    variable: 'segment',
    values: ['recordings', 'transcripts'],
    bindings: ["const segment = kind === 'recording' ? 'recordings' : 'transcripts';"],
    markers: [],
  },
];

// Every place the emulator binds an interpolated route variable has to match a
// mapping declared above, or the expansion below would quietly use stale
// literals. Checking that one binding still exists is not enough: a second,
// differently valued loop would slip past it.
export function assertPackagedLiteralsCurrent(source) {
  for (const { variable, bindings, markers } of PACKAGED_ROUTE_LITERALS) {
    for (const marker of markers) {
      if (!source.includes(marker)) throw new Error(`packaged Graph emulator route shape changed near: ${marker}`);
    }
    const found = [...source.matchAll(
      new RegExp(`(?:const|let|var)\\s+${variable}\\s*=[^;]*;|for\\s*\\(\\s*(?:const|let)\\s+${variable}\\s+of\\s+[^)]*\\)`, 'g'),
    )].map((match) => match[0].replace(/\s+/g, ' ').trim());
    for (const binding of found) {
      if (!bindings.includes(binding)) {
        throw new Error(`packaged Graph emulator binds '${variable}' in an undeclared way: ${binding}`
          + ' — update PACKAGED_ROUTE_LITERALS in tools/microsoft-graph/validate-endpoints.mjs to match');
      }
    }
    for (const binding of bindings) {
      if (!found.includes(binding)) throw new Error(`packaged Graph emulator route shape changed near: ${binding}`);
    }
  }
}

export function discoverPackagedEmulatorRoutes() {
  const source = readFileSync(join(repoRoot, 'packages/emulators/msgraph/src/wire.ts'), 'utf8');
  assertPackagedLiteralsCurrent(source);

  const routes = [];
  for (const match of source.matchAll(/graph\.(get|post|patch|delete|put)\((?:`([^`]+)`|'([^']+)'|"([^"]+)")/g)) {
    const template = match[2] || match[3] || match[4];
    const method = match[1].toUpperCase();
    let expansions = [template];
    for (const { token, values } of PACKAGED_ROUTE_LITERALS) {
      if (!expansions.some((path) => path.includes(token))) continue;
      expansions = expansions.flatMap((path) => values.map((value) => path.replaceAll(token, value)));
    }
    for (const expanded of expansions) {
      if (expanded.includes('${')) {
        throw new Error(`unresolved interpolation in packaged Graph emulator route '${template}'`
          + ' — teach PACKAGED_ROUTE_LITERALS in tools/microsoft-graph/validate-endpoints.mjs about it'
          + ' rather than letting it canonicalize into a key segment');
      }
      routes.push({ version: 'v1.0', method, path: expanded.endsWith('/:variant') ? expanded.replace('/:variant', '/$value') : expanded });
    }
  }
  return routes;
}

export function discoverLegacyEmulatorRoutes() {
  const files = [
    'test-harness/graph-emulator/server.mjs',
    'test-harness/graph-emulator/entra.mjs',
  ];
  const routes = [];
  for (const file of files) {
    const source = readFileSync(join(repoRoot, file), 'utf8');
    for (const match of source.matchAll(/req\.method === ['"](GET|POST|PATCH|DELETE|PUT)['"]\s*&&\s*graphPath === ['"]([^'"]+)['"]/g)) {
      routes.push({
        version: match[2].startsWith('/tenantRelationships/') ? 'beta' : 'v1.0',
        method: match[1],
        path: match[2],
      });
    }
  }

  const server = readFileSync(join(repoRoot, files[0]), 'utf8');
  const entra = readFileSync(join(repoRoot, files[1]), 'utf8');
  const requireMarker = (source, marker, additions) => {
    if (!source.includes(marker)) throw new Error(`legacy Graph emulator route shape changed near: ${marker}`);
    routes.push(...additions);
  };
  requireMarker(server, "graphPath === '/me' || /^\\/users\\/[^/]+$/.test(graphPath)", [
    { version: 'v1.0', method: 'GET', path: '/me' },
    { version: 'v1.0', method: 'GET', path: '/users/{userId}' },
  ]);
  requireMarker(server, '/mailFolders$/.test(graphPath)', [
    { version: 'v1.0', method: 'GET', path: '/me/mailFolders' },
    { version: 'v1.0', method: 'GET', path: '/users/{userId}/mailFolders' },
  ]);
  requireMarker(server, '/mailFolders\\/[^/]+\\/messages$/.test(graphPath)', [
    { version: 'v1.0', method: 'GET', path: '/me/mailFolders/{folderId}/messages' },
    { version: 'v1.0', method: 'GET', path: '/users/{userId}/mailFolders/{folderId}/messages' },
  ]);
  requireMarker(server, 'const messageMatch = graphPath.match', [
    { version: 'v1.0', method: 'GET', path: '/me/messages/{messageId}' },
    { version: 'v1.0', method: 'GET', path: '/users/{userId}/messages/{messageId}' },
    { version: 'v1.0', method: 'GET', path: '/me/messages/{messageId}/$value' },
    { version: 'v1.0', method: 'GET', path: '/users/{userId}/messages/{messageId}/$value' },
  ]);
  requireMarker(server, 'const subscriptionMatch = graphPath.match', [
    { version: 'v1.0', method: 'PATCH', path: '/subscriptions/{subscriptionId}' },
    { version: 'v1.0', method: 'DELETE', path: '/subscriptions/{subscriptionId}' },
  ]);
  requireMarker(entra, 'const checkMemberGroups = req.method', [
    { version: 'v1.0', method: 'POST', path: '/users/{userId}/checkMemberGroups' },
  ]);
  return routes;
}

export function metadataAgeDays(metadata, now = Date.now()) {
  const pinnedAt = Date.parse(metadata?.pinnedAt ?? '');
  return Number.isNaN(pinnedAt) ? null : (now - pinnedAt) / MS_PER_DAY;
}

export function checkFreshness(metadata, now = Date.now()) {
  const ageDays = metadataAgeDays(metadata, now);
  if (ageDays === null) return "metadata.pinnedAt is missing or is not an ISO-8601 date; run 'npm run guard:microsoft-graph-endpoints:update'";
  if (!(metadata.maxAgeDays > 0)) return 'metadata.maxAgeDays must be a positive number of days';
  if (ageDays > metadata.maxAgeDays) {
    return `pinned Graph metadata is ${Math.floor(ageDays)} days old (limit ${metadata.maxAgeDays}); `
      + "run 'npm run guard:microsoft-graph-endpoints:update' to repin against current Microsoft metadata";
  }
  return null;
}

export function loadModels(metadata, dir = toolDir) {
  const models = {};
  const errors = [];
  for (const version of VERSIONS) {
    const compressedMetadata = readFileSync(join(dir, metadata[version]));
    const actualHash = createHash('sha256').update(compressedMetadata).digest('hex');
    if (actualHash !== metadata.sha256[version]) {
      errors.push(`${version} metadata checksum mismatch: expected ${metadata.sha256[version]}, got ${actualHash}`);
      continue;
    }
    models[version] = parseCsdl(gunzipSync(compressedMetadata).toString('utf8'));
  }
  return { models, errors };
}

export function auditCalls(models, calls, suppressions = []) {
  const errors = [];
  const suppressed = new Map();
  for (const suppression of suppressions) {
    const suppressionKey = key(suppression.version, suppression.method, suppression.pathTemplate);
    if (suppressed.has(suppressionKey)) errors.push(`duplicate suppression: ${suppressionKey}`);
    if (!suppression.reason) errors.push(`suppression without a reason: ${suppressionKey}`);
    suppressed.set(suppressionKey, false);
  }

  const checked = new Set();
  for (const call of calls) {
    const path = canonicalPath(call.path);
    const method = call.method.toUpperCase();
    const callKey = key(call.version, method, path);
    if (suppressed.has(callKey)) {
      suppressed.set(callKey, true);
      continue;
    }
    if (checked.has(callKey)) continue;
    checked.add(callKey);
    const model = models[call.version];
    if (!model) {
      errors.push(`${call.origin ?? 'call'}: ${callKey}: unknown Graph version '${call.version}'`);
      continue;
    }
    const failure = validatePath(model, path, method);
    if (failure) {
      errors.push(`${call.origin ?? 'call'}: ${callKey}: ${failure}`
        + ' — fix the call or add a justified suppression to tools/microsoft-graph/endpoints.json');
    }
  }

  for (const [suppressionKey, used] of suppressed) {
    if (!used) errors.push(`stale suppression matches no discovered call: ${suppressionKey} — delete it from tools/microsoft-graph/endpoints.json`);
  }
  return { errors, checked: checked.size };
}

export function runValidation({ config: overrides = config, now = Date.now() } = {}) {
  const errors = [];
  const freshness = checkFreshness(overrides.metadata, now);
  if (freshness) errors.push(freshness);

  const { models, errors: metadataErrors } = loadModels(overrides.metadata);
  errors.push(...metadataErrors);

  const sourceCalls = discoverSourceCalls();
  const emulatorRoutes = [...discoverPackagedEmulatorRoutes(), ...discoverLegacyEmulatorRoutes()];
  const suppressions = overrides.suppressions ?? [];
  const audit = metadataErrors.length
    ? { errors: [], checked: 0 }
    : auditCalls(models, [
      ...sourceCalls.map((call) => ({ ...call, origin: `source call in ${call.file}` })),
      ...emulatorRoutes.map((route) => ({ ...route, origin: 'emulator route' })),
    ], suppressions);
  errors.push(...audit.errors);

  if (errors.length) throw new Error(`Microsoft Graph endpoint guard failed:\n- ${errors.join('\n- ')}`);
  return {
    sourceCalls: sourceCalls.length,
    emulatorRoutes: emulatorRoutes.length,
    validatedPaths: audit.checked,
    suppressions: suppressions.length,
    metadataAgeDays: Math.floor(metadataAgeDays(overrides.metadata, now)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runValidation();
    console.log(`Microsoft Graph endpoint guard passed (${result.sourceCalls} source call sites, ${result.emulatorRoutes} emulator routes, `
      + `${result.validatedPaths} distinct paths validated against a ${result.metadataAgeDays}-day-old CSDL pin, ${result.suppressions} suppressions).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
