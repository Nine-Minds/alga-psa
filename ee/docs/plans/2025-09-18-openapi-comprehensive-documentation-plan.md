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

## 3. Phased Rollout Plan

### Phase 0 – Alignment & Discovery (Week 0–1)
**Goals**
- Confirm scope (CE + EE) and stakeholder expectations.
- Inventory current routes, schemas, and existing doc consumers.

**Tasks**
- [ ] Export route inventory from `server/src/app/api/**`, capturing path, method, edition, auth mode, owning team, and source controller.
- [ ] Interview/key sync with product, integrations, and partner success to confirm external/internal consumers and their deliverables.
- [ ] Draft and circulate OpenAPI program charter (scope, success metrics, governance/RACI, release cadence) for approval.

**Exit Criteria**
- Signed-off scope document & RACI.
- Backlog created with all missing schemas/metadata items.

### Phase 1 – Schema Foundation (Week 1–2)
**Goals**
- Ensure every endpoint has canonical Zod schemas for inputs/outputs.

**Tasks**
- [ ] Compare route inventory against `server/src/lib/api/schemas/**` and log endpoints lacking request/query/response Zod schemas.
- [ ] Implement missing schemas for legacy controllers, ensuring each controller imports the canonical definitions.
- [ ] Publish shared schema module covering errors, pagination, RBAC payloads, metadata, and update controllers to reference it.
- [ ] Add unit tests validating schema shape (e.g., `zod` parsing fixtures) and integrate into CI.

**Exit Criteria**
- 100% of routes mapped to Zod schemas.
- Shared schema library published and referenced by controllers.

### Phase 2 – Route Metadata Registry (Week 2–3)
**Goals**
- Expose consistent OpenAPI metadata for every route.

**Tasks**
- [ ] Define `ApiRouteSpec` TypeScript interface (path, method, summary, tags, security, schemas, extensions).
- [ ] Create `server/src/lib/api/openapiRegistry.ts` exporting helpers to register components/paths without triggering controller side effects.
- [ ] Update each controller to expose a `registerOpenApi(registry)` function that records paths and attaches Zod schemas.
- [ ] Ensure every route includes `x-edition`, `x-rbac-resource`, `x-tenant-header-required`, and other necessary extensions.
- [ ] Add automated test verifying registry enumeration covers the full route inventory.

**Exit Criteria**
- Registry can enumerate all CE + EE paths with associated schemas.
- Unit test verifies controllers register expected routes.

### Phase 3 – Generator & Automation (Week 3–4)
**Goals**
- Produce authoritative CE/EE specs on demand and in CI.

**Tasks**
- [ ] Refactor `sdk/scripts/generate-openapi.ts` to import the registry, register shared components, and iterate over all route specs.
- [ ] Add CLI options for edition selection, output directory, and version stamp injection; document usage.
- [ ] Update npm scripts (`openapi:generate:ce`, `openapi:generate:ee`) to invoke the generator with appropriate flags.
- [ ] Introduce CI job that runs the generator, compares output against committed files, and fails on divergence.
- [ ] Announce new workflow in engineering release notes / Slack once CI is green.

**Exit Criteria**
- `npm run openapi:generate:ce|ee` outputs complete specs.
- CI job ensures committed spec is current.

### Phase 4 – Publication & Developer Experience (Week 4–6)
**Goals**
- Make the spec discoverable and easy to work with.

**Tasks**
- [ ] Stand up Swagger UI or Redoc endpoint (Next.js route or static export) sourcing the generated YAML spec(s).
- [ ] Update `sdk/README.md`, contributor guide, and onboarding docs with the generation workflow, review checklist, and approval policy.
- [ ] Create and publish `docs/openapi/CHANGELOG.md` tracking spec revisions with owner assignments.
- [ ] Generate example SDK/client artifacts (e.g., TypeScript client, Postman collection) and link them from docs.
- [ ] Update PR template with checklist item referencing OpenAPI spec updates when modifying API endpoints.

**Exit Criteria**
- Public/internal documentation site live with CE/EE specs.
- Contributor checklist adopted in PR template.

### Phase 5 – Continuous Verification & Enhancements (Week 6+)
**Goals**
- Keep the spec trustworthy and extend automation.

**Tasks**
- [ ] Implement smoke contract tests (e.g., Vitest + fetch) validating sample endpoints against Zod schemas and run them in CI.
- [ ] Automate changelog entries (script or manual template) whenever the spec changes; enforce via PR checklist.
- [ ] Assess automated SDK generation (e.g., `openapi-generator-cli`) and document recommendation for go-live.
- [ ] Schedule quarterly spec reviews with stakeholder teams to confirm accuracy and capture new requirements.

**Exit Criteria**
- Smoke contract tests passing in CI.
- Changelog process in place with ownership assigned.

## 4. Timeline Snapshot
| Phase | Focus | Target Window |
|-------|-------|---------------|
| 0 | Alignment & discovery | Week 0–1 |
| 1 | Schema foundation | Week 1–2 |
| 2 | Metadata registry | Week 2–3 |
| 3 | Generator & automation | Week 3–4 |
| 4 | Publication & DX | Week 4–6 |
| 5 | Continuous verification | Week 6+ |

## 5. Risks & Mitigations
- **Schema gaps / drift**: Some legacy endpoints lack Zod validation → front-load refactor time in Phase 1 and pair with domain owners.
- **Controller import side effects**: Registry must avoid executing business logic during generation → isolate metadata in pure modules, use lazy imports.
- **Spec churn fatigue**: Large diffs overwhelm PR reviewers → maintain spec changelog and auto-generate diff summaries in CI.
- **EE confidentiality**: EE-only routes should stay internal → enforce `x-edition` tagging and restrict public publishing pipeline.

## 6. Open Questions
- Do we introduce formal API versioning alongside the spec rollout?
- Where should HTML documentation live (Next.js vs. dedicated static hosting)?
- Should spec publication trigger automated SDK/regression testing?
- Preferred contract-testing framework (Prism, Dredd, custom harness)?

## 7. Immediate Next Steps
1. Review/approve phased plan with API leadership.
2. Staff owners for Phases 0–3 (schema lead, tooling lead, doc lead).
3. Kick off Phase 0 discovery (route inventory + stakeholder interviews).
4. Prepare tracking board (Jira/Notion) seeded with Phase 1 tasks.
