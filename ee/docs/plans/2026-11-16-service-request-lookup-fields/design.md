# Design — data-sourced lookup field type (contact / user picker)

Card `d500e12b` · internal PSA `alga-2026-0003314` · branch
`feature/service-requests-contact-user-lookup-field-type` · app `:3765`.
Step: Design Session (conn — XO desk).

## The customer's problem, stated generally

An onboarding form must ask for "Manager" and the answer must be **a contact of the
requester's own client**, picked from that client's people — not typed as free text into a
`short-text` field. Today the only answer shapes are a scalar string, a boolean, a date or a
file, and a `select` picks from a list the author typed in by hand
(`server/src/lib/service-requests/basicFormBuilder.ts:5-11, 38-45`).

So the missing concept is not "a contact field". It is a **field whose option set is resolved
from an entity table, in a scope derived from the requester** — with the answer being a
reference, not a label. Contact is the first instance; MSP staff is the second; location and
asset are the same mechanism with another adapter.

## Design

### 1. One new field type, described by data

```ts
type BasicFormFieldType =
  | 'short-text' | 'long-text' | 'select' | 'checkbox' | 'date' | 'file-upload'
  | 'lookup';

interface BasicFormFieldLookup {
  /** Which entity table the options come from. */
  entity: 'contact' | 'user';
  /** Which universe the options are drawn from, relative to the requester. */
  scope: 'requester-client' | 'tenant';
  /** Optional equality filters on the entity row (e.g. { is_manager: true }). */
  filters?: Record<string, string | boolean>;
}

interface BasicFormField {
  // ...existing
  lookup?: BasicFormFieldLookup;
}
```

Defaults that keep authors honest: `contact` ⇒ `requester-client` (the card's default); `user`
⇒ `tenant`. `select`'s static `options` and a `defaultValue` are **not allowed** on a lookup
field — its option set is data, not schema. The answer is the entity's **id** (see §3).

Why one type with a descriptor rather than `contact-picker` / `user-picker`: the form builder,
the renderer, the validator, the ticket-text renderer and the display path each need exactly
one branch. Adding `asset` or `location` later is a new adapter in the resolver (§4) and no
new branches anywhere.

### 2. Unknown field types must fail, not quietly become short-text

`normalizeBasicFormSchema` coerces every unsupported `type` to `'short-text'`
(`basicFormBuilder.ts:86-88`) *before* `validateBasicFormSchema` checks membership
(`:178-180`) — so that check is unreachable by construction, and worse, the coercion is what
gets saved back: opening and saving a draft that carries an unrecognised type **rewrites the
author's schema**. The card's Done criterion "unknown types should fail validation instead of
silently degrading" is therefore a two-line fix in the normalizer, plus the consequence:

- `normalizeBasicFormSchema` preserves the raw `type` string; `validateBasicFormSchema` rejects
  anything outside `SUPPORTED_FIELD_TYPES` with the field's label and index.
- The editor renders an invalid-type field with an error and blocks save/publish, instead of
  offering to save a mutation the author never made.
- Rendering never receives an unknown type through the portal path: a published version is
  only produced from a schema that passed validation. (Defence in depth: the form renderer
  draws an inert error row rather than a text input, so a legacy published definition cannot
  masquerade as free text.)

Recorded as a deliberate behaviour change: a legacy draft with an unknown type will now refuse
to save until the author fixes it. That is the correct reading of "fail validation", and it is
the only way an author ever learns the type was wrong.

### 3. The answer is a reference; labels are resolved, never stored in the payload

`submitted_payload` stays `Record<string, unknown>` of scalars. A lookup answer is the entity
**id string**: `{ "manager": "3f7c…-contact-id" }`.

That keeps every consumer that does equality/comparison on answers working unchanged — field
visibility rules (`computeVisibleFieldKeys` compares stored values), required checks
(`isMissingRequiredValue`), mapping rules and workflow filters. What it costs is display: a raw
id must never reach a human.

Three display choke points, one helper:

| Where | What changes |
| --- | --- |
| Ticket subject/description (`ticketTextTemplate.ts:69-93`) | new `case 'lookup'` returning the resolved label, falling back to the id only when the entity is gone; `renderServiceRequestTemplate` accepts `lookupLabels?: Record<string,string>` |
| MSP submission detail (`submissionHistory.ts` detail DTOs + the editor's submission panel) | resolves the same map before rendering |
| Client portal submission history | same |

The **ticket body gets a snapshot**: `ticketOnlyExecutionProvider` resolves labels at execution
time (it already holds `knex`, `tenant` and the requester context) and passes them into the
template render. So a ticket says "Manager: Jane Doe" forever, while a submission screen shows
the current label and degrades to a placeholder if the entity was deleted. **No new column, no
denormalised label in the payload.**

### 4. The resolver: one function, three jobs

New `server/src/lib/service-requests/lookupFields.ts`:

```ts
export interface LookupOption { id: string; label: string; secondaryLabel?: string }
export interface LookupRequester { clientId: string; contactId?: string | null }

export async function resolveLookupOptions(knex, tenant, lookup, requester): Promise<LookupOption[]>
export async function resolveLookupLabels(knex, tenant, fields, payload, requester): Promise<Record<string,string>>
export async function validateLookupAnswers(knex, tenant, fields, payload, requester): Promise<string[]>
```

- `resolveLookupOptions` dispatches on `lookup.entity` through a small adapter map:
  - `contact`: `contacts` where `client_id = requester.clientId` and not inactive, label =
    `first_name last_name`, secondary = company/role. This is the card's default and the reason
    the portal cannot leak another client's people: **the scope comes from the requester
    context, never from a client-supplied parameter**.
  - `user`: tenant `users` with `user_type = 'msp'` and active, label = display name.
  - asset / location are adapters of the same shape; deliberately not implemented here (§ scope).
- `validateLookupAnswers` is the **security boundary**, not a convenience: the browser can post
  any UUID, so every visible lookup answer must resolve to an id inside the field's own option
  list for this requester. Errors name the field by label, same as the existing required-field
  messages (`submissionService.ts:210-250`).
- `resolveLookupLabels` is the display/ticket path, one query per entity type per call.

The portal and the MSP on-behalf-of door (`e7b32dbb`, requester substitution) both work with no
extra code: the resolver reads `clientId`/`contactId` from the submission context, and that
context already carries the *chosen contact's* client when a technician files for a client.
That is the second reason the substitution card and this one belong on the same engine.

### 5. Validation order at submit

`submitPortalServiceRequest` (`submissionService.ts:254`) already: loads the published version →
recomputes visible keys → validates schema → inserts. Insert one step:

1. structural validation (sync, existing) — required fields, now including lookups;
2. **`validateLookupAnswers`** (async, new) against the *recomputed visible* lookup fields —
   hidden lookup fields are neither required nor validated;
3. insert, audit, execute — unchanged.

Rejections are the same shape as today's validation failures (a user-facing message list), not
a 500.

### 6. UI

- **Editor** (`ServiceRequestDefinitionEditorPage.tsx` field model `:170-197`): type list gains
  "Lookup"; a lookup row shows an entity select (Contact / MSP user) and a read-only scope line
  ("Contacts of the requester's client" / "Everyone in the workspace"). Options/default fields
  are not shown for lookups. Authoring validation errors surface per field as they do today.
- **Portal form** (`RequestServiceForm.tsx`, the shared component): the server page resolves
  options for the definition's lookup fields with the requester context and passes
  `lookupOptions: Record<fieldKey, LookupOption[]>`; the form renders `ContactPicker` or
  `UserPicker` — the existing components (`packages/ui/src/components/ContactPicker.tsx`,
  `UserPicker.tsx`), not new widgets — writing the id into the same `values` map and the same
  named form input, so the submit path, required-check and visibility evaluation are untouched.
  A hidden lookup field contributes nothing to the payload.
- **Submission detail** (MSP and portal) shows labels via the resolved map.

### 7. What the ticket sees

Ticket description renders `{{manager}}` as the contact's name (snapshot, §3). The id itself
stays in the submission payload, so mapping rules and workflows can key on it — which is the
card's "Store the selected entity id (not just a display string)" requirement, satisfied without
rendering uuids to customers.

## Acceptance trace

> a form can include "Manager" as a searchable contact picker limited to the requester's client,
> and the chosen contact id is in the submission answers

- "a form can include … as a contact picker": `lookup` type + editor row (§1, §6).
- "searchable … limited to the requester's client": `ContactPicker` over
  `resolveLookupOptions('contact', 'requester-client')` (§4, §6) — a genuinely searchable
  picker, not a `<select>` of hundreds of names.
- "the chosen contact id is in the submission answers": payload holds the id (§3), and the id is
  **verified server-side to belong to that client** (§4, §5) — so the guarantee survives a
  hand-crafted request, not just a well-behaved form.
- Plus the card's second clause: unknown types fail validation instead of degrading (§2).

## What we are deliberately NOT doing

- **No new table, column or migration.** Schema and payload are already jsonb.
- **No asset or location adapter in this card.** The resolver is an adapter map; those two need
  their own scoping decisions (which assets of a client, which locations) and are worth their
  own review. The mechanism is here; the instances are not free-riding on this card's scope.
- **No multi-select, no remote/paged search.** A client's contact list is small; the picker
  filters locally. If a tenant's list ever justifies paging, it belongs in the resolver, not in
  the field type.
- **No label snapshot column.** Ticket body snapshots at creation; everything else resolves live.
- **No lookup field as a visibility *controller* in the authoring picker.** Their value is an id,
  which makes label-based rules a trap; they may still be hidden/shown by other fields' rules.
- **No editing of an answer after submission**, no "prefill from the requester's own record".

## Order of work

1. `basicFormBuilder`: `lookup` type, `lookup` descriptor, normalizer stops coercing, schema
   validation (entity required, no options/defaults, filters shape).
2. `lookupFields.ts` with adapters + the three functions; unit tests.
3. Submit path: async lookup validation between schema validation and insert; integration tests.
4. Display: `ticketTextTemplate` lookup case + `lookupLabels` plumbing through
   `ticketOnlyExecutionProvider`; submission detail DTOs.
5. Editor UI: type, entity select, validation errors.
6. Portal form rendering with the existing pickers; page-side option resolution.
7. Optional filters (`filters` on the descriptor) wired to the contact adapter query.

## Tests

- **Unit — schema**: normalizer preserves an unknown type; `validateBasicFormSchema` rejects it
  (proves the previously dead check now fires); lookup requires `entity`, refuses `options` and
  `defaultValue`, rejects an unknown entity; `filters` must be scalars.
- **Unit — resolver**: contact options contain only the requester's client; another client's
  contact is absent even when its id is posted; inactive contacts/users excluded; tenant
  isolation on `user`; `requester-client` without a contact still works (contact id optional).
- **Integration (real Postgres, card's own suite)**: a published definition with a required
  contact lookup — submit with a valid id stores the id and creates a ticket whose description
  shows the contact's **name**, not the uuid; submitting a contact id from another client is
  refused with a field-labelled error and creates no submission; a **hidden** lookup field is not
  required and its posted value is ignored; a lookup on a legacy definition with no options
  still renders; required lookup missing → the existing required-field error.
- **Component**: `RequestServiceForm` renders a lookup field, selecting an option writes the id
  into the form data, and the submit button's required-field pre-check treats an empty lookup
  like any other empty required field; `ContactPicker` receives only the scoped options.
- **Manual (Prepare Human Review)**: author a form with a Contact lookup, publish it, open it in
  the client portal as a contact of client X, search "Manager", pick a colleague, submit, and
  see the name in the ticket description — then try the same form as a contact of client Y and
  confirm client X's people are not in the list.

## Risks

- **Answer display is a new pass/fail surface.** Every place that renders a submission answer
  must resolve labels; a missed one shows a uuid to a customer. The three sites are enumerated
  in §3 and each gets a test.
- **Scope comes from the context, never the request.** The resolver signature takes only the
  requester context — no `clientId` parameter to tamper with. Code review should reject any
  later variant that accepts one.
- **The normalizer change is a behaviour change for existing drafts** (§2). Intended, but it can
  block publishing a definition that has been quietly broken; surfaces as a field-level error,
  not a crash.
- **Option lists grow with the client.** Local search is fine for hundreds; a 10k-contact client
  would need paging in the resolver (noted, not built).
- **`formatAnswer`'s default branch renders objects as `''` and unknown types as raw strings** —
  the lookup case must be explicit in that switch, or a forgotten label map prints ids.
