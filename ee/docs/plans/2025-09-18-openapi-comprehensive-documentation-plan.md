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

**Key Activities**
- Catalog every API route under `server/src/app/api/**` with edition, authentication, and owning team.
- Identify spec consumers (partners, SDKs, internal teams) and capture requirements.
- Finalize success metrics and governance (who approves spec changes, release cadence).

**Exit Criteria**
- Signed-off scope document & RACI.
- Backlog created with all missing schemas/metadata items.

### Phase 1 – Schema Foundation (Week 1–2)
**Goals**
- Ensure every endpoint has canonical Zod schemas for inputs/outputs.

**Key Activities**
- Audit existing schemas; add missing ones for legacy controllers.
- Standardize shared types (errors, pagination, RBAC responses, metadata objects).
- Add schema tests to guard against breaking changes.

**Exit Criteria**
- 100% of routes mapped to Zod schemas.
- Shared schema library published and referenced by controllers.

### Phase 2 – Route Metadata Registry (Week 2–3)
**Goals**
- Expose consistent OpenAPI metadata for every route.

**Key Activities**
- Add `registerOpenApi` (or equivalent) metadata exports per controller.
- Introduce `openapiRegistry.ts` to collect route specs without side effects.
- Annotate endpoints with edition (`x-edition`), RBAC resource/action, tenant requirements.

**Exit Criteria**
- Registry can enumerate all CE + EE paths with associated schemas.
- Unit test verifies controllers register expected routes.

### Phase 3 – Generator & Automation (Week 3–4)
**Goals**
- Produce authoritative CE/EE specs on demand and in CI.

**Key Activities**
- Upgrade `sdk/scripts/generate-openapi.ts` to consume the registry.
- Add CLI flags (`--edition`, `--output`) and version stamping.
- Wire GitHub Action (or pipeline) to regenerate spec and fail on diff.

**Exit Criteria**
- `npm run openapi:generate:ce|ee` outputs complete specs.
- CI job ensures committed spec is current.

### Phase 4 – Publication & Developer Experience (Week 4–6)
**Goals**
- Make the spec discoverable and easy to work with.

**Key Activities**
- Publish Swagger UI / Redoc (Next.js route or static hosting) using generated YAML.
- Update docs (`sdk/README.md`, contributor guide) with workflow, changelog, approval process.
- Provide sample SDK generation scripts / Postman collections.

**Exit Criteria**
- Public/internal documentation site live with CE/EE specs.
- Contributor checklist adopted in PR template.

### Phase 5 – Continuous Verification & Enhancements (Week 6+)
**Goals**
- Keep the spec trustworthy and extend automation.

**Key Activities**
- Add contract tests comparing live responses against Zod schemas for critical paths.
- Track spec changes in `docs/openapi/CHANGELOG.md`.
- Evaluate automated SDK generation or partner-specific bundles.

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
