import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ZodTypeAny } from 'zod';
import { ApiOpenApiRegistry } from './registry';
import { ApiRouteSpec } from './types';

type InventoryRecord = {
  edition: 'CE' | 'EE';
  route_path: string;
  methods: string[];
};

const PLACEHOLDER_DESCRIPTION =
  'This operation was generated automatically from the route inventory. Replace with canonical OpenAPI metadata.';

function normalizeEdition(
  edition: InventoryRecord['edition'],
): 'ee' | undefined {
  if (edition === 'EE') {
    return 'ee';
  }
  return undefined;
}

function buildSummary(method: string, path: string): string {
  const verb = method.toUpperCase();
  const resource = path.replace(/^\/api\/?/, '').split('/')[0] || 'endpoint';
  return `${verb} ${resource}`;
}

function deriveTags(path: string): string[] {
  const segments = path.split('/').filter(Boolean);
  const index = segments.findIndex((segment) => segment === 'api');
  if (index !== -1 && index + 1 < segments.length) {
    const candidate = segments[index + 1];
    if (/^v\d+/i.test(candidate) && index + 2 < segments.length) {
      return [segments[index + 2].replace('{', '').replace('}', '')];
    }
    return [candidate.replace('{', '').replace('}', '')];
  }
  return [segments[0] ?? 'api'];
}

function selectSuccessStatus(method: string): string {
  switch (method.toLowerCase()) {
    case 'post':
      return '201';
    case 'delete':
      return '204';
    default:
      return '200';
  }
}

export function registerInventoryBackfillRoutes(
  registry: ApiOpenApiRegistry,
  deps: { ErrorResponse: ZodTypeAny; PlaceholderObject: ZodTypeAny },
) {
  const records = loadRouteInventory();

  const seen = new Set(
    registry
      .getRegisteredRoutes()
      .map((route) => `${route.method.toLowerCase()}::${route.path}`),
  );

  for (const record of records) {
    const edition = normalizeEdition(record.edition);
    for (const method of record.methods) {
      const lowerMethod = method.toLowerCase();
      const key = `${lowerMethod}::${record.route_path}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const successStatus = selectSuccessStatus(lowerMethod);

      const routeSpec: ApiRouteSpec = {
        method: lowerMethod as ApiRouteSpec['method'],
        path: record.route_path,
        summary: buildSummary(method, record.route_path),
        description: PLACEHOLDER_DESCRIPTION,
        tags: deriveTags(record.route_path),
        responses: {
          [successStatus]: {
            description: 'Placeholder success response',
            schema: deps.PlaceholderObject,
          },
          401: {
            description: 'Authentication required',
            schema: deps.ErrorResponse,
          },
          403: {
            description: 'Forbidden',
            schema: deps.ErrorResponse,
          },
        },
        extensions: {
          'x-generated-from': 'docs/openapi/route-inventory.json',
          'x-placeholder': true,
        },
        edition,
      };

      if (['post', 'put', 'patch'].includes(lowerMethod)) {
        routeSpec.request = {
          body: {
            schema: deps.PlaceholderObject,
            description: 'Placeholder request body',
          },
        };
      }

      registry.registerRoute(routeSpec);
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadRouteInventory(): InventoryRecord[] {
  const candidatePaths = [
    path.resolve(__dirname, '../../../../../docs/openapi/route-inventory.json'),
    path.resolve(process.cwd(), 'docs/openapi/route-inventory.json'),
    path.resolve(process.cwd(), '../docs/openapi/route-inventory.json'),
  ];

  for (const candidate of candidatePaths) {
    try {
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf-8');
        return JSON.parse(content) as InventoryRecord[];
      }
    } catch {
      // Ignore and try the next candidate path.
    }
  }

  return [];
}
