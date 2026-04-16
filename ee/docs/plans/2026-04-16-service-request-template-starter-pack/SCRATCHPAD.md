# Scratchpad — Service Request Template Starter Pack

- Plan slug: `service-request-template-starter-pack`
- Created: `2026-04-16`

## Decisions

- (2026-04-16) Expand the CE starter pack to six common MSP service templates.
- (2026-04-16) Use process-style names for the template and default definition metadata.
- (2026-04-16) In the management UI, selecting an example should create the draft and navigate directly to its editor instead of just returning to the list.
- (2026-04-16) Keep the pack vendor-neutral overall with a light Microsoft 365 bias where natural.
- (2026-04-16) Use balanced forms rather than minimal or highly prescriptive forms.
- (2026-04-16) Include only lightweight approval-ish fields such as justification, needed-by date, and occasional manager name.
- (2026-04-16) Leave `category_id` unset for all built-in templates because category assignment currently depends on tenant-scoped `service_categories` rows.

## Discoveries / Constraints

- (2026-04-16) Template drafts can only prefill `metadata.categoryId`, not a portable category name.
- (2026-04-16) Service request definitions reuse `service_categories` for category linkage and publish-time category-name snapshots.
- (2026-04-16) Auto-creating or name-matching categories during template instantiation would couple starter templates to tenant billing/service category data.
- (2026-04-16) The CE-safe basic field types are `short-text`, `long-text`, `select`, `checkbox`, `date`, and `file-upload`.
- (2026-04-16) Added `app-window` to the service request icon catalog so the Software / License template has a selectable editor icon, not just a renderable stored value.
- (2026-04-16) The service request provider registry stores built-ins in a global singleton. In a long-lived dev server, hot reload could preserve a stale `ce-starter-pack` provider instance with only one template until the registry was refreshed.

## Commands / Runbooks

- Inspect current starter templates:
  - `rg -n "starterTemplateProvider|listServiceRequestTemplateOptions|createServiceRequestDefinitionFromTemplate" server/src`
- Run focused service request tests:
  - `cd server && set -a && source ../.env.localtest && set +a && npx vitest run src/test/unit/service-requests/providerRegistry.unit.test.ts src/test/unit/service-requests/starterTemplateProvider.unit.test.ts src/test/integration/serviceRequestDefinitionManagement.integration.test.ts src/test/integration/serviceRequestTemplateInstantiation.integration.test.ts`

## Validation

- (2026-04-16) Focused service request tests passed:
  - `src/test/unit/service-requests/providerRegistry.unit.test.ts`
  - `src/test/unit/service-requests/starterTemplateProvider.unit.test.ts`
  - `src/test/integration/serviceRequestDefinitionManagement.integration.test.ts`
  - `src/test/integration/serviceRequestTemplateInstantiation.integration.test.ts`
- (2026-04-16) Added a provider-registry regression test to verify built-ins refresh over stale singleton state during dev-style reloads.
- (2026-04-16) Added a management-page unit test covering example selection -> draft creation -> router navigation to the new definition.

## Links / References

- CE starter template provider: `server/src/lib/service-requests/providers/builtins/starterTemplateProvider.ts`
- Template instantiation path: `server/src/lib/service-requests/definitionManagement.ts`
- Basic form schema validation: `server/src/lib/service-requests/basicFormBuilder.ts`
- Original service request PRD: `ee/docs/plans/2026-03-29-service-request-definitions/PRD.md`
- Design doc: `docs/plans/2026-04-16-service-request-template-starter-pack-design.md`
