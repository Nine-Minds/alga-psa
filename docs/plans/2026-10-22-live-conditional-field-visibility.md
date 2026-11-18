# Live conditional field visibility in service-request forms

Status: design of record for the Design Session step. Decisions here are binding for Draft Implementation.

# Live conditional field visibility for service requests

Worktree read: `/home/robert/alga-copies/feature-service-requests-live-conditional-field-visibili` @ `0c10002bc8`.

## Corrections to the card's analysis

- **"re-validate server-side on submit" is mostly already built.** `submissionService.ts:276-303`
  recomputes visibility from `initialValues + payload` and
  `validateSubmissionAgainstPublishedSchema` already skips hidden required fields
  (`submissionService.ts:189-224`). What is actually broken is the *earlier* pre-upload check in
  `actions.ts:177-186`, which passes the load-time `detail.visibleFieldKeys` (computed from
  `initialValues`) — that stale set is what rejects a revealed required field or accepts a
  hidden one. "Hidden answers dropped" is genuinely new.
- **There is no MSP on-behalf submission form.** The only form component in the tree is
  `server/src/app/client-portal/request-services/[definitionId]/RequestServiceForm.tsx`; MSP has
  an editor (`ServiceRequestDefinitionEditorPage.tsx`) and a submission viewer, no submit path.
  That half of "Done =" cannot be implemented without first building that surface — out of scope here.
- Card cites `providers.ts:206-345`; the rule helpers run to line 410. Also `payload.a.b` is
  *not* a dotted traversal despite the syntax (`values['a.b']`) — preserve it.

## What changes

### 1. New shared evaluator (the one architectural decision)

Add `server/src/lib/service-requests/formVisibility.ts`, **dependency-free**: no `knex`, no
`@alga-psa/db`, no registry, no `server-only`, and no type import from `contracts.ts` (it pulls
Knex types). Pure data in/out so a Next client component, the EE provider (server), and the
submission service can all import the same module.

Exports — move, don't reimplement, the bodies at `ee/server/src/lib/service-requests/providers.ts:361-410`:

- `VisibilityRuleOperator`, `VisibilityRule { fieldKey; source; operator; value? }`
- `VisibilityContext { requesterUserId; clientId; contactId? }`
- `resolveVisibilitySourceValue(source, values, context)` — copy of `providers.ts:361-383`
- `evaluateVisibilityRule(rule, value)` — copy of `providers.ts:385-410`
- `parseVisibilityRules(config)` — the rule half of `parseAdvancedFormBehaviorConfig`
  (`providers.ts:316-359`), including its silent dropping of invalid rules
- `validateVisibilityRules(config): string[]` — the `visibilityRules` branch of
  `validateConfig` (`providers.ts:217-258`); EE keeps the wrapper that also checks `contextDefaults`
- `computeVisibleFieldKeys(fields, rules, values, context): string[]` — the ordered resolver

`ee/.../providers.ts` already imports across the app (`server/src/lib/service-requests/domain` at
line 1), so this import is consistent. Then delete the local copies and have `advancedFormBehaviorProvider.resolveVisibleFieldKeys`
(`providers.ts:282-315`) delegate.

### 2. Portal page passes rules instead of a pre-filtered list

- `page.tsx:59-72` — stop filtering `fields` by `detail.visibleFieldKeys`; pass all fields.
- `page.tsx:115-140` — add `visibility={{ enabled, rules, context }}` to `RequestServiceForm`,
  where `enabled = detail.formBehaviorProvider === 'advanced' && rules.length > 0`, and `context`
  is built from the session (`requesterUserId`, `clientId`, `contactId`; **never** `tenant`).
  Keep `visibleFieldKeys` on the detail type for no-JS fallback and server checks.
- `RequestServiceForm.tsx` — collapse `selectValues` (63-77) and `dateValues` (79-88) into one
  `values: Record<string, unknown>` seeded from `initialValues`, and make short-text / long-text
  / checkbox controlled (they are `defaultValue` / `defaultChecked` today and cannot re-render).
  Compute the visible key set in the component body with `computeVisibleFieldKeys` and render
  only those fields. The component is SSR'd too, so first paint already agrees with the server;
  unmounted inputs mean the browser submits no hidden answers and enforces no hidden `required`.

### 3. Server re-validation and pruned payload

- `actions.ts`: keep building `payload` (144-172), then compute the key set from
  `detail.formSchema` + `parseVisibilityRules(detail.formBehaviorConfig)` + `initialValues + payload`
  and pass **that** to the pre-upload validation at 177-186. Keeps the early check (no wasted
  file uploads) without stale visibility.
- `submissionService.ts`: replace the inline IIFE at 280-303 with one exported
  `resolveSubmissionVisibility(detail, payload)` used by both call sites.
- Prune before persistence (`submissionService.ts:330-338`) and before
  `executionProvider.execute` (~line 430): `payload` filtered to visible keys, `attachments`
  filtered by `fieldKey`. Then `submitted_payload`, the ticket/workflow payload, and the audit
  and search events all see only visible answers.

**Trust: nothing.** Hidden-ness is recomputed from the same payload the request is about to
persist. The browser never sends `visibleFieldKeys` and the server never reads one, so an
attacker can choose which branch to submit but cannot make a hidden field required and cannot
smuggle a non-rendered field into `submitted_payload` or the execution context.

### 4. Builder: per-field "Show when…"

- Home: `FormFieldEditorCard` (`ServiceRequestDefinitionEditorPage.tsx:357-556`), which already
  receives `allFields`.
- Save with the existing `updateServiceRequestFormBehaviorConfigAction`
  (`server/src/app/msp/service-requests/actions.ts:450-466`), writing the whole
  `{...config, visibilityRules}`. No new action, no new column, no `form_schema` change.
- Rules for field F are the subset with `rule.fieldKey === F.key`; saving replaces only that
  subset and preserves `contextDefaults` and other fields' rules.
- Minimum viable editor: rows of source (select of *preceding* fields plus the three
  `context.*` sources), operator (the six, localised), value (text input; select of the source
  field's `options` when the source is a select; true/false when it is a checkbox). Add/remove
  row. AND across rows, which is already the semantics (`providers.ts:305-312`).
- Storage unchanged: `form_behavior_config.visibilityRules`, validated by the EE provider at
  publish (`definitionValidation.ts:83-91`), snapshotted into the version row and read back by
  `portalDetail.ts:146-160`.
- The JSON `TextArea` at `ServiceRequestDefinitionEditorPage.tsx:1804-1844` collapses to a
  read-only "Advanced (JSON)" disclosure rendered from live state — it must not simply vanish,
  because `form_behavior_config` also holds `contextDefaults`, which has no visual editor.
- Gate on `showAdvancedFormBehaviorConfigPanel` (`definitionEditor.ts:186-192`). New keys under
  `editor.form.visibility.*` in `server/public/locales/*/msp/service-requests.json` (all six
  locales; `editor.i18n.test.tsx` asserts parity).

## Rule semantics to preserve (reused, not re-implemented)

| operator | true when |
|---|---|
| `equals` | `sourceValue === rule.value` (strict; `true` ≠ `"true"`) |
| `not-equals` | `sourceValue !== rule.value` |
| `is-true` | `true \| 'true' \| 'on' \| '1'` |
| `is-false` | `false \| 'false' \| 'off' \| '0' \| null \| undefined \| ''` |
| `has-value` | not null/undefined and `String(v).trim().length > 0` |
| `is-empty` | null/undefined/whitespace-only |

Sources: bare key (`values[source]`), `payload.<key>`, `context.requesterUserId|clientId|contactId`.
Multiple rules per field are ANDed. Invalid rules are dropped at parse; invalid config fails
publish. Submit-time validation currently happens in `validateSubmissionAgainstPublishedSchema`
(`submissionService.ts:189-224`).

**CE degradation:** `@enterprise` resolves to `packages/ee/src/lib/service-requests/providers.ts`,
whose registration function returns `null` (lines 1-3), so only the built-in `basic` provider is
registered and `portalDetail.ts:139-142` returns `null` for `form_behavior_provider === 'advanced'`.
Such definitions do not render at all in CE, so the client half must be gated on the
server-computed `enabled` flag and never receives rules in CE/basic.

**Ordering semantics (one function, both sides):** evaluate top-down in document order, one pass;
a source field already decided hidden contributes `undefined`. This makes "controller hidden ⇒
dependent hidden" automatic, makes cycles structurally impossible, and matches what a user
perceives scanning the form. It is a deliberate tightening: today the load-time path evaluates
every rule against the full initial-values map, so a chained rule can stay visible off a hidden
field's default. Document it in the module header and unit-test it.

## Order of work

1. `formVisibility.ts` + unit test. Verify the existing `serviceRequestAdvancedFormBehavior`
   integration suite still passes unchanged with the provider delegating.
2. Rewire EE `providers.ts`, delete duplicates, keep validation messages byte-identical
   (`serviceRequestAdvancedFormBehavior.integration.test.ts:304` asserts the exact string).
3. `resolveSubmissionVisibility` + prune, used in `submissionService.ts` and the `actions.ts`
   pre-upload check. Verify: hidden required field never blocks; hidden answer absent from
   `submitted_payload`.
4. `page.tsx` stops filtering, passes all fields + `visibility`. Update `page.test.tsx`
   expectations that asserted hidden fields were absent.
5. `RequestServiceForm.tsx`: unified `values`, controlled inputs, client-side key set. Verify in
   jsdom: toggling the controller mounts/unmounts the dependent field and `FormData` has no
   hidden key.
6. Builder per-field editor + i18n; collapse the JSON textarea. Verify the save round-trips and
   `contextDefaults` survives.
7. Optional, non-blocking: use `computeVisibleFieldKeys` in `FormFieldPreview`
   (`ServiceRequestDefinitionEditorPage.tsx:2109-2130`) so the design preview honours rules.

## Explicit non-goals

- No new operators (`in`, `gt`, `contains`, regex), no OR/NOT grouping, no nested groups.
- No per-field storage in `form_schema.fields`; rules stay in `form_behavior_config.visibilityRules`.
- No new provider key, no change to the provider contract or registry (`contracts.ts:43-63`).
- Not `visibility_provider` / `advanced-visibility` (`providers.ts:412+`): that is audience
  gating (who may see the definition), a different concept.
- No conditional required-ness, conditional defaults, or conditional sections.
- No migration/backfill; existing rule JSON must keep working.
- No MSP on-behalf form (see corrections).

## Risks and gotchas

- **Rules depending on hidden fields.** Handled by document-order evaluation; the builder only
  offers preceding fields, so no new forward references. Legacy ones stay deterministic (source
  contributes empty).
- **Cycles.** Impossible in single pass. Do not later "fix" this with a fixpoint loop without
  changing the server too, or the two paths disagree.
- **Defaults at load.** Both sides seed from the same `initialValues`, so first paint agrees. The
  trap is leaving `detail.visibleFieldKeys` as the render filter — that is the bug. Also `equals`
  is strict: a checkbox rule whose stored `value` is `"true"` never matches a boolean default, so
  the editor must emit JSON booleans for checkbox sources (warn on legacy strings).
- **Controlled inputs.** Converting text inputs changes `RequestServiceForm.test.tsx` behaviour
  around `defaultValue`; initialisation is identical but `initialValues` changes now need an
  effect or a keyed form.
- **File uploads.** `RequestServiceForm.tsx:168-180` is an uncontrolled `<input type=file>`;
  hiding unmounts it and clears any selection (correct, but surprising). The server must filter
  `attachments` by visible key or stale `pendingUploads` survive pruning.
- **Tenancy.** Rules/fields come from the tenant's published version; the client is sent no
  `tenant` value, and `visibilityContext` is assembled inside the server component from the
  session. Submit re-fetches via `getVisiblePublishedServiceRequestDefinitionDetail`
  (`tenantDb`-scoped), so a tampered client cannot redirect the server at another definition's config.
- **Replay.** `clientSubmissionKey` replays skip validation (`submissionService.ts:247-260`), so
  pruning must happen before insert or a replay can return an unpruned payload.
- **Pre-existing publish gap.** `validateConfig` cannot see the schema, so a rule targeting a
  non-existent field key publishes cleanly today. Consider a *warning* in `definitionValidation.ts`
  (which does have `definition.form_schema`) rather than an error, to avoid breaking existing definitions.

## How it will be tested

- `server/src/test/integration/serviceRequestAdvancedFormBehavior.integration.test.ts` — T037
  already covers "required hidden fields do not block submit" (~line 234) and exact validation
  strings (~line 304). Add: revealed-then-submitted required field blocks; hidden answer absent
  from `submitted_payload`; chained rule (B depends on A; A hidden ⇒ B hidden).
- `server/src/app/client-portal/request-services/[definitionId]/RequestServiceForm.test.tsx` —
  jsdom + `userEvent`. Add: changing the controller mounts the dependent field immediately;
  unmounting removes it from `FormData`; a hidden required field does not fail `form.checkValidity()`.
- `server/src/app/client-portal/request-services/[definitionId]/page.test.tsx` — update the
  "hidden field absent" expectation to "present but gated by `visibility.enabled`".
- `server/src/test/unit/app/client-portal/request-services/submitRequestServiceDefinitionAction.test.ts`
  — assert the pre-upload validation gets recomputed keys, not `detail.visibleFieldKeys`.
- New `server/src/test/unit/service-requests/formVisibility.unit.test.ts` — all six operators,
  all source forms, AND of multiple rules, invalid-rule dropping, top-down hidden-source
  behaviour, strict-equality checkbox trap.
- `server/src/test/integration/serviceRequestPortalDetail.integration.test.ts` — provider
  absence still returns `null` (CE degradation).
- `server/src/test/unit/app/msp/service-requests/editor.i18n.test.tsx` — new keys in all locales.
