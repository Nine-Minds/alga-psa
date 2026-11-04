# Plan: API registry — contact phone_numbers item shape and POST /time-entries body schema

Ticket: alga0002071 · Branch: `feature/alga0002071-api-registry-document-contact-phone` · Base: `main` @ `b0d0b4dacf`

## Problem

The OpenAPI registry (and the MCP/chat API registry generated from it) documents request bodies that the server does not accept:

1. **`POST`/`PUT /api/v1/contacts`**: `ContactBody` in `server/src/lib/api/openapi/routes/clientsContacts.ts:147` declares `phone_numbers` and `additional_email_addresses` as `z.array(z.record(z.unknown()))`. A caller can't tell what fields a row needs. The reporter sent `{ type: "work", ... }`. Zod stripped `type`, and the model rejected the row with `phone_numbers.0: Choose a canonical type or provide a custom type`. The 500 from that path is already fixed by #2892. The root cause is still there: the registry describes a shape the server doesn't accept.
2. **`POST /api/v1/time-entries`**: `WorkV1CreateTimeEntryBody` (`workManagementV1.ts:234`) documents `started_at`, `ended_at`, `duration_minutes`, `billable_minutes`, and `user_id`, and marks everything optional. The server validates `createTimeEntrySchema` (`server/src/lib/api/schemas/timeEntry.ts`), which requires `work_item_type`, `start_time`, `end_time` (with end after start), and `service_id`. A request built only from documented fields always fails.

Both schemas were copied by hand from the validators and have since drifted away from them.

## Verified facts (from current code)

- `zOpenApi` is the same `z` instance as `zod` (`registry.ts:228`, `extendZodWithOpenApi(z)`). Real request schemas can be registered directly, and `routes/services.ts` already does this with `createServiceSchema`/`updateServiceSchema`.
- I probed `@asteasolutions/zod-to-openapi` 6.4.0 by registering `createContactSchema`, `updateContactSchema`, `createTimeEntrySchema`, and `updateTimeEntrySchema` and building a document. All four render correctly:
  - Contact: full phone row (`phone_number` required; `canonical_type` enum `work|mobile|home|fax|other`; `custom_type`, `extension`, `is_default`, `display_order`, `contact_phone_number_id`), full email row (`canonical_type` enum `work|personal|billing|other`), and `additionalProperties: false` at the top level, because `createContactSchema` is already `.strict()`. `contact_kind` is correctly absent from the update schema.
  - Gaps in the rendered output: `extension` loses `null`, and `email`/`email_address` lose `format: email`, both because of transform→pipe. Rules enforced in `superRefine` or the model aren't expressible in the schema: exactly one default phone, canonical XOR custom type, and a custom label must not repeat a canonical label.
  - Time entry: correct field names and the `work_item_type` enum. **But `service_id` renders as optional**, because "required" is enforced in `superRefine`, which can't be seen when the schema is converted to OpenAPI.
- `createContactSchema`/`updateContactSchema` are used only by `ApiContactController` and unit tests. The UI and Entra sync go through `shared/models/contactModel.ts` (`contactFormSchema`, `phoneRowInputSchema`), so tightening the API item schemas does not affect web/UI callers.
- Contact updates replace the whole set: when `phone_numbers` / `additional_email_addresses` is present on PUT, it replaces all rows (`contactModel.ts:1141-1145`).
- Model rules (`contactModel.ts` ~600-665) that should be stated in descriptions:
  - every phone row needs `canonical_type` **or** `custom_type`, never both;
  - `custom_type` must not equal a canonical label;
  - custom labels must not repeat;
  - when any phone rows are present, exactly one must be `is_default: true`.
- Generated artifact chain. Nothing in CI checks drift, so regenerate by hand:
  1. `sdk/scripts/generate-openapi.ts` writes `sdk/docs/openapi/alga-openapi.{ce,ee}.{json,yaml}`, plus the legacy `alga-openapi.{json,yaml}` mirror of CE.
  2. `npm run mcp:registry:generate` (`ee/scripts/generate-chat-registry.mjs`) reads those specs and writes `server/src/lib/mcp/registry.generated.ts` (CE, served by `/api/v1/meta/mcp-registry` and the connector) and `ee/server/src/chat/registry/apiRegistry.generated.ts` (EE chat). `search_api_registry` reads these generated files.
  - `docs/openapi/*` (route inventory and schema coverage) depends on route paths, not body shapes. Re-run `scripts/analyze_schema_coverage.py` only if its output changes; no diff is expected.
  - `ee/docs/api-registry/*.json` has no overrides for `POST /contacts` or `/time-entries`, so it is unaffected.

## Design decisions

### D1. Derive the OpenAPI bodies from the real zod input schemas
Register the validator schemas themselves; don't copy them. This makes drift structurally impossible, which is the card's main aim, and it follows an existing precedent (`services.ts`).

- `clientsContacts.ts`:
  - `ContactBody` becomes `registry.registerSchema('ContactBody', createContactSchema)`. Keep the component name stable for SDK consumers.
  - Add `ContactUpdateBody` = `updateContactSchema` and use it for `PUT /api/v1/contacts/{id}`, replacing `ContactBody.partial()`. Today's `.partial()` wrongly allows `contact_kind` on update.
- `workManagementV1.ts`:
  - `WorkV1CreateTimeEntryBody` becomes `createTimeEntrySchema`. Keep the name.
  - Add `WorkV1UpdateTimeEntryBody` (`updateTimeEntrySchema`) for `PUT /time-entries/{id}`.
  - Add `WorkV1BulkCreateTimeEntriesBody`, `WorkV1BulkUpdateTimeEntriesBody`, and `WorkV1BulkDeleteTimeEntriesBody` (the `bulk*TimeEntrySchema` exports) for the `/time-entries/bulk` routes. These currently fall back to `GenericBody` on the same body-selection line (`:482`), and the real schemas already exist.
  - Leave the remaining time-entries routes (`start-tracking`, `approve`, and so on) as they are; they are outside this card's scope.
  - Rewrite line 482 as a small `path+method → schema` lookup so it stays readable.

### D2. Make `service_id` required at the type level in `createTimeEntrySchema`
A `superRefine` requirement doesn't show up in OpenAPI, so the derived schema would repeat today's bug: a body missing `service_id` would look valid. Restructure `timeEntry.ts`:

```ts
const createTimeEntryObjectSchema = baseTimeEntrySchema.extend({
  service_id: z.string({ required_error: 'service_id is required for time entries' }).uuid(),
});
export const createTimeEntrySchema = createTimeEntryObjectSchema.superRefine((d, ctx) =>
  validateTimeEntryWrite(d, ctx, { requireServiceId: true }));
```

The update schema keeps its current behavior: it is still derived from `baseTimeEntrySchema`, with `rejectClearingServiceId`. Requests are validated the same way as before:
- same `service_id` issue path;
- same message when the field is missing;
- an empty string now fails the `.uuid()` check rather than the custom check, still on path `service_id`.

`timeEntryServiceRequirement.test.ts` asserts only `path[0] === 'service_id'`, so it still passes. `bulkTimeEntrySchema` inherits the change.

### D3. Rules the schema can't express go in `.describe()` text on the real schemas
Add `.describe(...)` (not `.openapi()`: schema modules load at runtime without the OpenAPI extension, and zod-to-openapi turns `.describe()` into `description`) to:

- **Phone item:**
  - "Each row needs `canonical_type` (work|mobile|home|fax|other) or `custom_type`, not both."
  - "When any rows are sent, exactly one must have `is_default: true`."
  - "On update, the array replaces all of the contact's phone numbers; include `contact_phone_number_id` to keep an existing row."
  - Describe `extension` as digits only.
- **Email item:** the canonical/custom XOR rule (work|personal|billing|other) and the replace-all behavior on update.
- **Time entry:**
  - `start_time`/`end_time`: ISO 8601; `end_time` must be after `start_time`; duration is computed and can't be submitted.
  - `service_id`: required; it drives billing.
  - `work_item_id`: required for ticket/project_task/interaction. Confirm this against `TimeEntryService.create` during implementation, and word the description to match the real behavior.

Also add `.openapi`-free metadata, such as `describe` on the `email` field, so that "valid email" still shows up even though the format is lost. Don't bend the shared `@alga-psa/validation` field schemas to fix the rendered output.

### D4. Make the phone and email item schemas `.strict()`, but accept the read-only response keys
`.strict()` makes `type: "work"` fail with `Unrecognized key(s) in object: 'type'` at `phone_numbers.0`, instead of a later model error that's harder to read. The card asked us to consider this, and it's safe for UI callers (see Verified facts).

There is a real compatibility risk: clients that send a GET result straight back as a PUT. Response rows include `normalized_phone_number` and `custom_phone_type_id` (phone), and `normalized_email_address` and `custom_email_type_id` (email). A plain `.strict()` would reject those PUTs. Today those keys are silently stripped, and the model ignores them.

**Decision:** declare these four keys explicitly on the input item schemas as optional and accepted, documented as "read-only; ignored on write". Then make the items `.strict()`.
- Round-trip clients keep working.
- Unknown keys fail loudly.
- The model never receives the extra keys: strip them in the schema with `.transform` and omit them before they reach `ContactService`, or confirm the model's own `phoneRowInputSchema` strips them. It does, because it is a non-strict `z.object`, so no transform is needed.

**Not doing:** making `baseTimeEntrySchema` strict. Today, existing time-entry callers that send `user_id` are silently ignored; strict mode would turn that into a 400. That is a behavior change the card doesn't ask for.

### D5. Leverage marker
The phone and email row shape is defined twice: once in the API (`server/src/lib/api/schemas/contact.ts`) and once in the model (`shared/models/contactModel.ts` `phoneRowInputSchema` / `emailRowInputSchema`). Add `// LEVERAGE: pattern contact-row-input-schema — API and model each define the phone/email row input shape` at both sites. Don't merge them in this card.

## Files to change

| File | Change |
|---|---|
| `server/src/lib/api/schemas/contact.ts` | Export the phone/email item input schemas. Add `.describe()` text. Make the items `.strict()` with the four read-only response keys accepted. Add the LEVERAGE marker. |
| `server/src/lib/api/schemas/timeEntry.ts` | Add `createTimeEntryObjectSchema` with `service_id` required; derive `createTimeEntrySchema` from it. Add field descriptions. |
| `server/src/lib/api/openapi/routes/clientsContacts.ts` | `ContactBody` becomes `createContactSchema`; new `ContactUpdateBody` used for PUT `/contacts/{id}`. |
| `server/src/lib/api/openapi/routes/workManagementV1.ts` | `WorkV1CreateTimeEntryBody` becomes `createTimeEntrySchema`. Add update and bulk bodies. Replace the line-482 ternary with a lookup. |
| `shared/models/contactModel.ts` | LEVERAGE marker only. |
| `sdk/docs/openapi/alga-openapi{,.ce,.ee}.{json,yaml}` | Regenerated. |
| `server/src/lib/mcp/registry.generated.ts`, `ee/server/src/chat/registry/apiRegistry.generated.ts` | Regenerated. |
| `server/src/test/unit/validation/contactPhoneSchemas.test.ts` | New cases (see Tests). |
| `server/src/test/unit/validation/timeEntryServiceRequirement.test.ts` | Keep the existing tests; add a type-level-required case. |
| `server/src/test/unit/api/contactTimeEntryRegistryBodies.contract.test.ts` (new) | Contract test on the generated artifacts, following `ticketSilentApiMcp.contract.test.ts`. |

## Implementation steps

1. Make the `timeEntry.ts` restructure (D2) and the `contact.ts` item changes (D3, D4). Run the existing unit tests: `contactPhoneSchemas`, `contactEmailSchemas`, `timeEntryServiceRequirement`, and `clientContactValidationParity`.
2. Swap the OpenAPI route bodies (D1).
3. Regenerate the artifacts:
   ```sh
   cd sdk && npx tsx scripts/generate-openapi.ts --edition ce && npx tsx scripts/generate-openapi.ts --edition ee
   cd .. && npm run mcp:registry:generate
   ```
   Check that the diff to the generated files covers only the contact and time-entry bodies, plus any component additions.
4. Add the tests below and run the targeted vitest files.
5. Do live verification against the dev server (`http://feature-alga0002071-api-registry-document-contact-phone.localhost:3117`, API key from the local stack). See Verification.

## Tests

- **Schema unit tests:**
  - A phone row with `type: "work"` is rejected at path `phone_numbers.0` with an unrecognized-key issue.
  - A phone row with `canonical_type: "work", is_default: true` is accepted.
  - A row containing the response-only keys (`normalized_phone_number`, `custom_phone_type_id`) is accepted, and those keys are not passed downstream.
  - The equivalent cases for email rows.
  - `createTimeEntrySchema` with no `service_id` is rejected at path `service_id` with message `service_id is required for time entries`.
  - `end_time <= start_time` is rejected at path `end_time`.
- **Contract test on the generated artifacts** (CE and EE OpenAPI JSON, plus both MCP registries):
  - `POST /api/v1/contacts` `requestBodySchema.properties.phone_numbers.items.properties` includes `phone_number`, `canonical_type` (with the enum), `custom_type`, and `is_default`, and `phone_number` is required. The same holds for the `additional_email_addresses` item.
  - `POST /api/v1/time-entries` has `start_time`, `end_time`, and `service_id`, with `required ⊇ [work_item_type, start_time, end_time, service_id]`. It has none of `started_at`, `ended_at`, or `duration_minutes`.
  - A drift guard: the CE OpenAPI body for each operation deep-equals a fresh `buildDocument` result from `buildBaseRegistry`. This catches generated files that someone forgot to regenerate.

## Verification (definition of done)

1. In the regenerated `server/src/lib/mcp/registry.generated.ts`, `post-_api_v1_contacts` and `post-_api_v1_time-entries` show the real fields and item shapes. Also check the dev server's `/api/v1/meta/mcp-registry` output. The production `search_api_registry` will show them after deploy.
2. Live contact create:
   - `POST /api/v1/contacts` with `phone_numbers: [{ phone_number: "+1 555 0100", canonical_type: "work", is_default: true }]` returns 201.
   - The same request with `type: "work"` instead returns 400 with an unrecognized-key message.
   - A PUT that sends a GET row back unchanged returns 200.
3. Live time-entry create: `POST /api/v1/time-entries` using only documented fields (`work_item_type`, `work_item_id`, `start_time`, `end_time`, `service_id`, `notes`) returns 201. Leaving out `service_id` returns 400 `service_id is required for time entries`.
4. The `docs/openapi/*` inventory or coverage is regenerated if it changed; no change is expected.

## Out of scope

- Merging the API and model row schemas (see the LEVERAGE marker).
- Strict mode for time-entry bodies.
- Real body schemas for the other `/time-entries/*` action routes and for time-sheets, time-periods, and schedules.
