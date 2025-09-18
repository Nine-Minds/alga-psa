# OpenAPI Comprehensive Documentation Plan

## 1. Objectives
- Publish an authoritative OpenAPI 3.1 specification that covers every CE/EE REST endpoint.
- Make spec updates part of the normal development workflow (automated generation + CI guardrails).
- Support downstream use cases: SDK generation, external docs, partner onboarding, contract testing.

## 2. Current State
- APIs live under `server/src/app/api/**` with controllers in `server/src/lib/api/controllers`.
- Zod schemas exist in `server/src/lib/api/schemas`, but some controllers hand-roll validation.
- A minimal generator (`sdk/scripts/generate-openapi.ts`) produces service-category endpoints only.
- No centralized registry of routes or metadata; spec isn’t auto-generated in CI.

## 3. Scope & Deliverables
1. **Spec Coverage**
   - CE core endpoints (tickets, contacts, companies, assets, billing, workflows, auth, etc.).
   - EE-specific endpoints (provisioning, partner APIs) flagged via `x-edition: enterprise`.
   - Shared schemas (errors, pagination, RBAC permissions, metadata).
2. **Tooling**
   - Route metadata registry integrated with controllers.
   - Generation script that walks the registry + emits JSON/YAML.
   - CI job (GitHub Actions) verifying specs are up to date.
3. **Documentation & Processes**
   - Contributor guide for updating metadata & schemas.
   - Spec publishing pipeline (Swagger UI/Redoc / static export).
   - Contract-testing harness option for key endpoints.

## 4. Strategy Overview
1. **Standardize Validation**
   - Ensure every route uses a Zod schema (request body, query, params, responses).
   - Backfill schemas where missing; refactor controllers to rely on them.
2. **Introduce Route Metadata**
   - Add `registerOpenApi` exports per controller (path, method, tags, RBAC notes, schemas).
   - Include extension fields (`x-rbac-resource`, `x-tenant-header-required`, `x-edition`).
3. **Central Registry Module**
   - `server/src/lib/api/openapiRegistry.ts` collects metadata at import time.
   - Provide helper to register standard responses & components.
4. **Generator Script Upgrade**
   - Modify `sdk/scripts/generate-openapi.ts` to:
     - Import registry definitions.
     - Register schemas/components.
     - Emit spec per edition (flags `--edition ce|ee`).
5. **Automation**
   - Add `npm run openapi:generate:ce|ee` scripts.
   - CI job: regenerate + diff check during PR.
   - Optional: nightly job publishes HTML docs to internal site/S3.
6. **Quality Gates**
   - Add unit tests verifying registry registration (e.g., expect certain paths exist).
   - Integration tests validating runtime responses against spec (sampling key endpoints via Zod).

## 5. Workstreams & Tasks

### Workstream A – Schema Audit & Backfill
- Inventory existing Zod schemas; map endpoints lacking coverage.
- Create missing request/response schemas (focus on legacy controllers).
- Add enums / shared types for RBAC responses, errors.

### Workstream B – Controller Metadata Instrumentation
- Define interface for metadata (`ApiRouteSpec`).
- Update controllers incrementally:
  1. Tickets
  2. Categories
  3. Companies/Contacts
  4. Assets
  5. Billing/Invoices
  6. Authentication (sessions/API keys)
  7. EE extras (provisioning, extensions).
- Include tests to ensure `registerOpenApi` align with `route.ts` exports.

### Workstream C – Generator & Publishing
- Enhance generator to consume metadata + output both CE/EE specs.
- Add CLI flags (`--edition`, `--output`), environment discovery, version stamping.
- Wire CI job to call generator and fail on diff.
- Build docs site (Next.js route or static Redoc) referencing generated YAML.

### Workstream D – Developer Experience
- Update `sdk/README.md` with workflow, add contributor checklist.
- Create `docs/openapi/CHANGELOG.md` tracking spec revisions.
- Provide scripts for Postman collection export or SDK generation (optional stretch).

## 6. Milestones
| Milestone | Description | Target |
|-----------|-------------|--------|
| M1 | Schema audit complete, backlog created | +1 week |
| M2 | Metadata registry implemented, tickets/categories covered | +2 weeks |
| M3 | Generator v2 emitting CE/EE specs with CI check | +3 weeks |
| M4 | Remaining controllers instrumented | +5 weeks |
| M5 | Public documentation (Swagger/Redoc) live | +6 weeks |
| M6 | Contract tests (smoke coverage) | +8 weeks |

## 7. Risks & Mitigations
- **Schema gaps / drift**: Some legacy endpoints lack Zod validation → allocate refactor time & pair with domain owners.
- **Controller import side effects**: Loading controllers during generation might require environment bootstrapping → isolate metadata in pure modules or guard imports.
- **Large spec churn**: Frequent schema updates might overwhelm reviews → maintain changelog + auto-generated diff summaries.
- **EE confidentiality**: Ensure EE-only routes marked clearly; avoid publishing private endpoints outside internal docs.

## 8. Open Questions
- Do we version the API? (If yes, incorporate `info.version` strategy + tags.)
- Where should HTML docs live (Next.js route vs. separate static hosting)?
- Should we auto-generate SDKs (TypeScript/Go) post-spec as part of release?
- Is there a preferred contract-testing framework (Prism, Dredd, custom)?

## 9. Next Steps
1. Approve plan scope and timeline.
2. Assign leads for Workstreams A–D.
3. Kick off schema audit (create tracking doc in Notion/Jira).
4. Prototype controller metadata on tickets/categories to validate approach.
5. Integrate results into the existing `openapi:generate` tooling for iterative rollout.
