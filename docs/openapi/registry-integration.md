# OpenAPI Registry Integration Plan

This document captures the scaffolding introduced for the new OpenAPI workflow and how it lines up with the comprehensive plan dated 2025-09-18.

## Architecture Overview
- `ApiOpenApiRegistry` wraps `@asteasolutions/zod-to-openapi` and centralises route/component registration. It enforces edition-aware filtering so we can emit CE or EE specifications from the same metadata.
- Shared components live in `server/src/lib/api/openapi/components.ts`. The base module currently registers API key security plus the canonical error envelope; additional shared schemas should be added here.
- Existing route generators (for now `registerServiceCategoryRoutes`) sit under `server/src/lib/api/openapi/routes/**`. Each registrar receives the shared component handles (e.g. `ErrorResponse`) and registers one or more routes.
- `buildBaseRegistry` in `server/src/lib/api/openapi/index.ts` wires everything together. Controllers will eventually expose `registerOpenApi(registry)` helpers that are imported here.
- `registerInventoryBackfillRoutes` hydrates placeholder operations for every path discovered in `docs/openapi/route-inventory.json`, so the generated spec now lists the full surface area (with `x-placeholder: true` until real metadata replaces it).
- `sdk/scripts/generate-openapi.ts` now consumes the registry, accepts CLI overrides (`--edition`, `--output`, `--version`, `--formats`, `--title`, `--description`), and writes edition-specific JSON + YAML artifacts (`alga-openapi.<edition>.{json,yaml}`). CE remains mirrored to the legacy `alga-openapi.{json,yaml}` files for backward compatibility.

## Controller Integration Pattern
1. **Add `registerOpenApi` export** to each controller module:
   ```ts
   import { registerTicketSchemas } from '@/lib/api/schemas/ticket';
   import { ApiOpenApiRegistry } from '@/lib/api/openapi';

   export function registerOpenApi(registry: ApiOpenApiRegistry) {
     const { ErrorResponse } = registerTicketSchemas(registry);

     registry.registerRoute({
       method: 'get',
       path: '/api/v1/tickets',
       summary: 'List tickets',
       tags: ['Tickets'],
       edition: 'both',
       security: [{ ApiKeyAuth: [] }],
       request: { query: ticketListQuerySchema },
       responses: {
         200: { description: 'Tickets', schema: ticketListResponseSchema },
         401: { description: 'Authentication failed.', schema: ErrorResponse },
       },
       extensions: {
         'x-rbac-resource': 'ticket',
         'x-tenant-header-required': true,
       },
     });
   }
   ```
2. **Update the registry builder** to import each controller registrar (`registerTicketRoutes(registry, deps)` or the inline `registerOpenApi` export).
3. **Ensure canonical schemas**: controllers should rely on the Zod definitions inside `server/src/lib/api/schemas/**`. The schema coverage report (`docs/openapi/schema-coverage.md`) lists 56 routes currently missing canonical coverage; those handlers should be refactored first.
4. **Edition annotations**: mark EE-only routes with `edition: 'ee'` so the generator automatically omits them from the CE artifact (and vice versa).

## Supporting Automation
- `scripts/generate_route_inventory.py` emits `docs/openapi/route-inventory.{json,csv}` (416 routes discovered). This underpins testability for "registry covers all routes" checks in CI.
- `scripts/analyze_schema_coverage.py` emits `docs/openapi/schema-coverage.{json,md}`. Use this to drive Phase 1 backlog: every route without canonical schemas must be addressed before registry adoption.
- Future work: add a Vitest suite that loads the registry and asserts parity against the CSV inventory (Phase 2 exit criteria).

## Next Steps (per comprehensive plan)
1. **Finish Phase 1**: implement/centralise Zod schemas for the 56 direct handlers highlighted in `schema-coverage.md`.
2. **Phase 2 kick-off**: progressively add `registerOpenApi` exports to controllers, feeding them into `buildBaseRegistry`. Gate progress with an inventory parity test.
3. **Phase 3**: extend `sdk/scripts/generate-openapi.ts` with CI guardrails (git diff check) and wire npm scripts (`openapi:generate:ce`, `openapi:generate:ee`).
4. **Phase 4+**: once registry coverage hits 100%, publish the CE/EE specs and add Redoc/Swagger UI exposure as outlined in the original plan.

Maintain the supporting docs (`route-inventory.csv`, `schema-coverage.md`) as living artifacts—regenerate them whenever routes or schemas change, and surface regressions via CI.
