#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const DEFAULT_SPEC_PATH = path.resolve(repoRoot, 'sdk/docs/openapi/alga-openapi.ee.json');
const OUTPUT_PATH = path.resolve(repoRoot, 'ee/server/src/chat/registry/apiRegistry.generated.ts');
const OVERRIDES_DIR = path.resolve(repoRoot, 'ee/docs/api-registry');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function loadSpec(specPath) {
  if (!fs.existsSync(specPath)) {
    throw new Error(`OpenAPI spec not found at ${specPath}. Run npm run openapi:generate first.`);
  }
  const content = fs.readFileSync(specPath, 'utf-8');
  return JSON.parse(content);
}

function resolveRef(spec, maybeRef) {
  if (!maybeRef || typeof maybeRef !== 'object' || !('$ref' in maybeRef)) {
    return maybeRef;
  }

  const ref = maybeRef.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error(`Unsupported $ref format: ${ref}`);
  }

  const parts = ref.slice(2).split('/');
  let current = spec;
  for (const part of parts) {
    current = current?.[part];
    if (current === undefined) {
      throw new Error(`Failed to resolve $ref: ${ref}`);
    }
  }
  return current;
}

function cloneSchema(schema) {
  if (schema === undefined) return undefined;
  return JSON.parse(JSON.stringify(schema));
}

function collectParameters(spec, pathItem, operation) {
  const params = [
    ...(Array.isArray(pathItem?.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(operation?.parameters) ? operation.parameters : []),
  ];

  const seen = new Set();
  const collected = [];

  for (const paramRef of params) {
    if (!paramRef) continue;
    const param = resolveRef(spec, paramRef);
    if (!param || typeof param !== 'object') continue;
    if ('in' in param === false || 'name' in param === false) continue;
    if (param.in !== 'query' && param.in !== 'path' && param.in !== 'header') continue;
    const key = `${param.in}:${param.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    collected.push({
      name: param.name,
      in: param.in,
      required: Boolean(param.required),
      description: param.description,
      schema: cloneSchema(resolveRef(spec, param.schema ?? {})),
    });
  }

  return collected;
}

function extractRequestBody(spec, operation) {
  if (!operation || !operation.requestBody) return { schema: undefined, example: undefined };
  const requestBody = resolveRef(spec, operation.requestBody);
  if (!requestBody || typeof requestBody !== 'object' || !requestBody.content) {
    return { schema: undefined, example: undefined };
  }

  const jsonContent = requestBody.content['application/json'];
  if (!jsonContent) return { schema: undefined, example: undefined };

  const schema = jsonContent.schema ? resolveRef(spec, jsonContent.schema) : undefined;
  const example = jsonContent.example ?? Object.values(jsonContent.examples ?? {})[0]?.value;

  return {
    schema: cloneSchema(schema),
    example: cloneSchema(example),
  };
}

function extractResponseBody(spec, operation) {
  const responses = operation?.responses ?? {};
  const statuses = Object.keys(responses).filter((code) => code.startsWith('2')).sort();
  if (statuses.length === 0) return undefined;
  const status = statuses[0];
  const response = resolveRef(spec, responses[status]);
  if (!response || typeof response !== 'object') return undefined;
  if (!response.content) return undefined;
  const jsonContent = response.content['application/json'];
  if (!jsonContent) return undefined;
  const schema = jsonContent.schema ? resolveRef(spec, jsonContent.schema) : undefined;
  return cloneSchema(schema);
}

function loadOverrides(dir) {
  const byId = new Map();
  const byMethodPath = new Map();

  if (!fs.existsSync(dir)) {
    return { byId, byMethodPath };
  }

  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse override file ${filePath}: ${error.message}`);
    }

    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    for (const entry of entries) {
      const match = entry?.match ?? {};
      if (match.id) {
        const list = byId.get(match.id) ?? [];
        list.push(entry);
        byId.set(match.id, list);
      }
      if (match.method && match.path) {
        const key = `${String(match.method).toLowerCase()} ${match.path}`;
        const list = byMethodPath.get(key) ?? [];
        list.push(entry);
        byMethodPath.set(key, list);
      }
    }
  }

  return { byId, byMethodPath };
}

function applyOverrides(entry, overrides) {
  const matches = [];
  if (overrides.byId.has(entry.id)) {
    matches.push(...(overrides.byId.get(entry.id) ?? []));
  }
  const key = `${entry.method} ${entry.path}`;
  if (overrides.byMethodPath.has(key)) {
    matches.push(...(overrides.byMethodPath.get(key) ?? []));
  }

  for (const override of matches) {
    const metadata = override?.metadata ?? {};
    if (metadata.displayName) entry.displayName = metadata.displayName;
    if (metadata.summary) entry.summary = metadata.summary;
    if (metadata.description) entry.description = metadata.description;
    if (metadata.rbacResource) entry.rbacResource = metadata.rbacResource;
    if (typeof metadata.approvalRequired === 'boolean') {
      entry.approvalRequired = metadata.approvalRequired;
    }
    if (Array.isArray(metadata.playbooks)) entry.playbooks = metadata.playbooks;
    if (Array.isArray(metadata.examples)) entry.examples = metadata.examples;
    if (Array.isArray(metadata.parameters)) entry.parameters = metadata.parameters;
    if (metadata.requestBodySchema !== undefined) entry.requestBodySchema = metadata.requestBodySchema;
    if (metadata.responseBodySchema !== undefined) entry.responseBodySchema = metadata.responseBodySchema;
  }
}

function createEntryId(method, pathName, operationId) {
  if (operationId) return operationId;
  return `${method}-${pathName.replace(/[{}]/g, '').replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9_]/g, '')}`.toLowerCase();
}

function collectOperations(spec) {
  const entries = [];
  const paths = spec.paths ?? {};

  for (const [pathName, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;

      const id = createEntryId(method, pathName, operation.operationId);
      const parameters = collectParameters(spec, pathItem, operation);
      const { schema: requestBodySchema, example: requestExample } = extractRequestBody(spec, operation);
      const responseBodySchema = extractResponseBody(spec, operation);

      const entry = {
        id,
        method,
        path: pathName,
        displayName: operation['x-chat-display-name'] ?? operation.summary ?? `${method.toUpperCase()} ${pathName}`,
        summary: operation.summary,
        description: operation.description,
        tags: Array.isArray(operation.tags) ? operation.tags : [],
        rbacResource: operation['x-chat-rbac-resource'] ?? operation['x-rbac-resource'],
        approvalRequired: Boolean(operation['x-chat-approval-required']),
        parameters,
        requestBodySchema,
        requestExample,
        responseBodySchema,
      };

      entries.push(entry);
    }
  }

  return entries;
}

function writeOutput(entries) {
  const header = `/* eslint-disable */\n// AUTO-GENERATED FILE. DO NOT EDIT.\n// Generated by ee/scripts/generate-chat-registry.mjs\n`;
  const importLine = `import { ChatApiRegistryEntry } from './apiRegistry.schema';\n\n`;
  const sanitized = entries.map((entry) => JSON.parse(JSON.stringify(entry)));
  const body = `export const chatApiRegistry: ChatApiRegistryEntry[] = ${JSON.stringify(sanitized, null, 2)};\n\nexport default chatApiRegistry;\n`;

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${header}${importLine}${body}`);
}

function main() {
  const specPath = process.env.CHAT_REGISTRY_SPEC_PATH
    ? path.resolve(repoRoot, process.env.CHAT_REGISTRY_SPEC_PATH)
    : DEFAULT_SPEC_PATH;

  const spec = loadSpec(specPath);
  const overrides = loadOverrides(OVERRIDES_DIR);
  const entries = collectOperations(spec);

  for (const entry of entries) {
    applyOverrides(entry, overrides);
  }

  writeOutput(entries);
  console.log(`Generated chat API registry with ${entries.length} entries.`);
}

const arg1 = process.argv[1];
const arg1Url = arg1 ? pathToFileURL(path.resolve(arg1)).href : '';

if (arg1 && import.meta.url === arg1Url) {
  main();
} else {
  // Support running via `node ee/scripts/generate-chat-registry.mjs`
  const resolvedArg = arg1 ? path.resolve(arg1) : '';
  if (resolvedArg === __filename) {
    main();
  }
}
