#!/usr/bin/env node
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(toolDir, '../..');
const registry = JSON.parse(readFileSync(join(toolDir, 'endpoints.json'), 'utf8'));

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

export function discoverPackagedEmulatorRoutes() {
  const source = readFileSync(join(repoRoot, 'packages/emulators/msgraph/src/wire.ts'), 'utf8');
  const routes = [];
  for (const match of source.matchAll(/graph\.(get|post|patch|delete|put)\((?:`([^`]+)`|'([^']+)'|"([^"]+)")/g)) {
    let path = match[2] || match[3] || match[4];
    const method = match[1].toUpperCase();
    if (path.includes('${root}')) {
      for (const root of ['/me', '/users/{userId}']) {
        const expanded = path.replace('${root}', root);
        routes.push({ version: 'v1.0', method, path: expanded.endsWith('/:variant') ? expanded.replace('/:variant', '/$value') : expanded });
      }
    } else {
      routes.push({ version: 'v1.0', method, path: path.endsWith('/:variant') ? path.replace('/:variant', '/$value') : path });
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

export function runValidation() {
  const errors = [];
  const registered = new Set();
  for (const endpoint of registry.endpoints) {
    const endpointKey = key(endpoint.version, endpoint.method, endpoint.pathTemplate);
    if (registered.has(endpointKey)) errors.push(`duplicate registry entry: ${endpointKey}`);
    registered.add(endpointKey);
  }

  for (const version of ['v1.0', 'beta']) {
    const metadataPath = join(toolDir, registry.metadata[version]);
    const compressedMetadata = readFileSync(metadataPath);
    const actualHash = createHash('sha256').update(compressedMetadata).digest('hex');
    if (actualHash !== registry.metadata.sha256[version]) {
      errors.push(`${version} metadata checksum mismatch: expected ${registry.metadata.sha256[version]}, got ${actualHash}`);
      continue;
    }
    const model = parseCsdl(gunzipSync(compressedMetadata).toString('utf8'));
    for (const endpoint of registry.endpoints.filter((entry) => entry.version === version)) {
      const failure = validatePath(model, endpoint.pathTemplate, endpoint.method);
      if (failure) errors.push(`${key(version, endpoint.method, endpoint.pathTemplate)}: ${failure}`);
    }
  }

  for (const call of discoverSourceCalls()) {
    const callKey = key(call.version, call.method, call.path);
    if (!registered.has(callKey)) errors.push(`unregistered source call in ${call.file}: ${callKey}`);
  }
  const emulatorRoutes = [...discoverPackagedEmulatorRoutes(), ...discoverLegacyEmulatorRoutes()];
  for (const route of emulatorRoutes) {
    const routeKey = key(route.version, route.method, route.path);
    if (!registered.has(routeKey)) errors.push(`unregistered emulator route: ${routeKey}`);
  }

  if (errors.length) throw new Error(`Microsoft Graph endpoint guard failed:\n- ${errors.join('\n- ')}`);
  return { endpoints: registry.endpoints.length, sourceCalls: discoverSourceCalls().length, emulatorRoutes: emulatorRoutes.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runValidation();
    console.log(`Microsoft Graph endpoint guard passed (${result.endpoints} registry entries, ${result.sourceCalls} source call sites, ${result.emulatorRoutes} emulator routes).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
