# Plan: inbound email rules, match client by device name or contact email

Card: alga-2026-0002568 · Branch: `feature/alga-2026-0002568-inbound-email-rules-match-clie`
Line numbers are from this worktree (HEAD `9fd1ddb58b`).

## Problem

TacticalRMM and UniFi alert emails come from a generic sender. The `extract_assign_client` rule
action can already pull a value out of the subject or body (`shared/services/email/inboundEmailRules/evaluator.ts:167`
`extractValue`). But the engine only compares that value with client names and client aliases
(`engine.ts:158-190` `matchClientByName`, called at `engine.ts:385`). An extracted hostname
(`DESKTOP-4F2K9`) or email address (`jane@acme.com`) therefore never resolves to a client.

## Design

### Config shape (no migration needed for the rule data)

Add an optional `match_by` field to `ExtractAssignClientActionConfig`. The field is stored in the
existing `action_config` JSONB column:

```ts
export type InboundEmailClientMatchTarget = 'client_name' | 'asset_name' | 'contact_email';

export interface ExtractAssignClientActionConfig {
  source: InboundEmailExtractionSource;
  extraction: InboundEmailExtraction;
  /** Which lookups the extracted value is tried against. Absent => ['client_name'] (pre-existing behaviour). */
  match_by?: InboundEmailClientMatchTarget[];
}
```

- `client_name` covers client name **and** alias, which matches today's behaviour.
- Existing rules have no `match_by` field, so the engine treats them as `['client_name']`. This keeps them byte-for-byte compatible with no backfill.
- The engine always evaluates the chosen targets in a **fixed canonical order**, not in the order they were stored: `client_name` → `contact_email` → `asset_name`. The most specific or unique key goes first (a contact email is unique per tenant). Asset names are not unique, so they go last. A fixed order means the result never depends on the order an admin happened to tick checkboxes.

### Match semantics

| Target | Normalisation of extracted value | Lookup | Excludes |
|---|---|---|---|
| `client_name` | `normalizeExtractedValue` (unchanged) | unchanged `matchClientByName` | inactive clients (unchanged) |
| `contact_email` | Pull the first email-shaped token out of the raw value (so `Jane Doe <jane@acme.com>` or a trailing `.` still works), then `normalizeEmailAddress` (`shared/lib/email/addressUtils`) | `contacts.email = ?` OR `contact_additional_email_addresses.normalized_email_address = ?` (both already indexed, see `contacts_tenant_email_unique` and `ux_contact_additional_email_addresses_tenant_normalized_email`) | inactive contacts, contacts with null `client_id`, inactive clients. **Internal users are not considered**: this lookup is about the client, not about who sent the email. |
| `asset_name` | `normalizeExtractedValue` | `lower(regexp_replace(trim(assets.name), '\s+', ' ', 'g')) = ?` joined to `clients` on `assets.client_id` | inactive clients |

Tactical's sync writes the agent hostname into `assets.name`
(`packages/integrations/src/lib/rmm/tacticalrmm/deviceSync.ts:612,623,673`). UniFi and manually
created assets also use `name`, so name alone covers both requesters.

**Ambiguity rule, the core safety decision:** if a lookup resolves to more than one **distinct
client** (for example, two clients each have a `RECEPTION-PC`), that target gives **no match**.
The engine does not guess. This follows the original feature's position that a wrong client
assignment is worse than no assignment (`docs/plans/2026-06-10-inbound-email-rules-design.md:262`
"Fuzzy client-name matching... rejected"). The ambiguity is recorded in the trace so the tester
can explain it. The walk then moves on to the next target. If no target resolves, the rule's
existing `on_no_match` logic runs unchanged (`engine.ts:487`).

Several assets with the same name that all belong to one client are **not** ambiguous. The client
match is used, and `assetId` is set only when exactly one asset matched.

### What the match carries forward

Extend the match and outcome types so downstream processing can use the specific record that
was found, not just its client:

```ts
export type InboundEmailClientMatchSource = 'client_name' | 'alias' | 'asset_name' | 'contact_email';

export interface InboundEmailClientMatch {
  clientId: string;
  matchedBy: InboundEmailClientMatchSource;
  contactId?: string;   // contact_email matches
  assetId?: string;     // asset_name matches with exactly one asset
}
// outcome 'assign_client' gains: matchedBy, contactId?, assetId?
// trace entry gains: clientMatchAmbiguity?: Array<{ target: InboundEmailClientMatchTarget; clientCount: number }>
```

Pipeline effects in `processInboundEmailInApp.ts` (new-ticket path only; rules already never run
for replies):

1. **Contact match:** the matched contact becomes the ticket contact. Today the rule path uses the
   client's primary contact (`processInboundEmailInApp.ts:1752-1757`). The matched contact is
   also passed as `matchedContactId` / `matchedContactClientId` to
   `resolveEffectiveInboundTicketDefaults` (`:1771-1790`), so a contact-level inbound destination
   (`contacts.inbound_ticket_defaults_id`) applies, the same as it would for a sender match.
   The comment author logic (`:1834-1842`) does **not** change: the email was still sent by the
   service mailbox, not by the contact.
2. **Asset match:** after `createTicketFromEmail` (`:1900`), link the asset to the ticket in
   `asset_associations` (`entity_type 'ticket'`). This is best-effort: a failure is logged and never
   fails ticket creation. `shared/rmm/alerts/ticketCreator.ts:143` already has a private
   `associateAsset` helper that does exactly this, including the `created_by` audit-user rule.
   **Move it into a shared asset helper and call it from both places** rather than writing it a
   second time. This is a small move and clearly the right one, so it is done here instead of
   left behind a LEVERAGE marker.
3. **Metadata:** `email_metadata.clientMatchSource` stays `'rule_extraction'`, so the event and
   diagnostics contract is unchanged. Add `ruleClientMatchedBy` (`client_name|alias|asset_name|contact_email`)
   next to `appliedRuleId` (`:1925`) so support can see why a client was chosen.

## Changes by file, in order of work

### 1. Types, validation, evaluator (pure, no DB)

- `shared/services/email/inboundEmailRules/types.ts`
  - `:37-40`: add `match_by?` and the new `InboundEmailClientMatchTarget` type.
  - `:81-86`: widen `InboundEmailClientMatchSource` and add `contactId?` / `assetId?`.
  - `:96-103`: `assign_client` outcome gains `matchedBy`, `contactId?`, `assetId?`.
  - `:115-137`: trace entry gains `clientMatchAmbiguity?`.
- `shared/services/email/inboundEmailRules/validation.ts:71-74`:
  `match_by: z.array(z.enum([...])).min(1).max(3).optional()`, with a refine that rejects duplicates.
  `:96-102` stays as it is: the discriminated config schema already runs through `ACTION_CONFIG_SCHEMAS`.
- `shared/services/email/inboundEmailRules/evaluator.ts`: add `resolveMatchTargets(config)`
  (defaults to `['client_name']`, dedupes, applies canonical order) and
  `extractEmailCandidate(raw): string | null`, placed next to `normalizeExtractedValue` (`:158`).
  Both are pure, so the tester and production share them.
- `index.ts`: export the new type and helpers.

### 2. Engine

- `engine.ts:37-48` `InboundEmailRuleEngineDeps`: add
  `matchClientByContactEmail(tenantId, normalizedEmail)` and
  `matchClientByAssetName(tenantId, normalizedName)`. Both return
  `{ match: InboundEmailClientMatch } | { ambiguous: true; clientCount: number } | null`.
  Keep `matchClientByName` as it is: the `ai_classify` path (`:453`) still uses only that.
- `engine.ts:136-222` `createDefaultDeps`: implement both matchers with the `tenantDb` +
  `withAdminTransaction` pattern already used in `matchClientByName`. Use `tenantJoin` to `clients`
  and the same active-client predicate (`:163-166`). Extract that predicate into a local helper
  shared by all three matchers so it is not written three times. The asset query selects
  `asset_id, client_id` with `limit(50)` (enough to detect ambiguity without loading everything);
  group by client in JS.
- `engine.ts:380-402` (the `extract_assign_client` case): replace the single `matchClientByName`
  call with `resolveClientMatch({ targets, rawValue, deps, tenantId })`. It walks the targets in
  canonical order, collects ambiguity notes, and returns the first unambiguous match.
  `isExtractAssignConfig` (`:224`) must accept configs with or without `match_by`. It should
  ignore unknown target strings rather than fail the rule, so a config written by a future
  version still evaluates.

### 3. Pipeline

- `shared/services/email/processInboundEmailInApp.ts`:
  - `:1708`: also read `ruleAssignedContactIdFromMatch` and `ruleAssignedAssetId` from the outcome.
  - `:1752-1757`: if the rule supplied a contact, use it. Otherwise keep the existing
    sender-in-client / primary-contact logic.
  - `:1771-1790`: when the rule supplied a contact, feed it to the destination cascade as the
    matched contact, as described above.
  - `:1925`: add `ruleClientMatchedBy`.
  - After the ticket is created (right after `:1932`, before the comment): best-effort asset
    association through the shared helper.
- Move `associateAsset` out of `shared/rmm/alerts/ticketCreator.ts:143-165` into a shared module
  (for example `shared/services/assets/assetTicketAssociation.ts`). The ticketCreator becomes a
  caller. Add a unique-violation guard (`23505` → no-op) so a retry of the same email never throws.

### 4. Settings UI and tester

- `packages/integrations/src/components/email/forms/InboundEmailRuleForm.tsx`
  - `:50-64` `readExtractionState`: read `match_by`, defaulting to `['client_name']`.
  - `:79-85`: new `matchTargets` state.
  - `:243-252`: include `match_by` in `action_config`. Always write it on save, so the saved rule
    records what the admin chose.
  - `:536-638`: add a "Match extracted value against" checkbox group with three options: Client
    name or alias / Contact email / Device (asset) name. At least one must be ticked, and the form
    blocks saving otherwise (same rule as the zod `.min(1)`). Replace the `matchHint` text (`:631-636`)
    with one that reflects the selection. The regex label "capture group 1 is the client name"
    (`:620`) becomes neutral ("capture group 1 is the value to match").
  - Tester (`:815-835`): badge text for the new sources ("Matched client via contact email",
    "... via device name"), and show the ambiguity notes ("Device name matches assets at 2
    clients — not assigned").
  - Alias quick-add (`:330-336`): show it only when `client_name` is among the targets. An alias
    does nothing for a rule that doesn't match on names.
- `packages/integrations/src/components/email/admin/InboundEmailRulesManager.tsx:108`: the rule
  summary mentions the targets when they are not the default.
- `server/public/locales/*/msp/email-providers.json`: add the new `inboundRules.form.*` and
  `inboundRules.tester.*` keys to `en` and to every other locale file already carrying this
  namespace (de, es, fr, it, nl, pl, pt, xx, yy), following the repo's existing locale workflow.
  Follow `alga-tech-doc-writing` for the copy.
- `packages/integrations/src/actions/email-actions/inboundEmailRulesActions.ts:467-515`
  (`testInboundEmailRule`): no change needed. It already uses the default deps, apart from
  `loadRules`, so the new matchers run against real tables. The only thing to check is that the
  returned evaluation serialises (it is plain data).

### 5. Index (migration)

`assets` has no index that serves `lower(name)` (checked on the live DB: only `pkey`,
`rmm_device`, `agent_status`, `notes_document`, `tenant_client_location`, `stock_unit`). Tenants
with RMM sync can have thousands of assets, and this lookup runs once for every new inbound email
that matches such a rule. Add
`server/migrations/<ts>_add_assets_normalized_name_index.cjs`:
`CREATE INDEX IF NOT EXISTS idx_assets_tenant_normalized_name ON assets (tenant, lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))`.
The query expression must be **textually identical** to the index expression, or the planner will
not use the index. Create it with `npx knex migrate:make` per `docs/AI_coding_standards.md:398`.
Verify it is Citus-safe: a plain `CREATE INDEX` on a distributed table propagates, but do not
use `CONCURRENTLY` inside the knex transaction.

## Out of scope

- Matching on asset tag, serial number, IP, MAC, or RMM device ID. Name is what the alert bodies
  contain. Other identifiers can be added later as new `match_by` targets without a schema change.
- Fuzzy or partial device-name matching (for example a substring or FQDN-vs-short-hostname
  match). This has the same wrong-client risk that ruled out fuzzy client names. Admins can trim
  the domain themselves with the extraction template or regex.
- New targets on the `ai_classify` path. That path still resolves only the AI's client name.
- Matching several values per email (for example every email address in the body). Extraction
  still produces one value.
- A new extraction template for "first email address in body". The existing `after`, `between`,
  and `regex` templates, plus `extractEmailCandidate`, cover it.
- Changing threading or reply handling, or the sender-contact comment author logic.

## Risks and gotchas

- **Wrong-client assignment through duplicate hostnames.** This is handled by the
  distinct-client ambiguity rule. It must be tested directly.
- **Priority between rule contact, sender contact, and primary contact.** The logic at
  `processInboundEmailInApp.ts:1745-1800` is subtle, and there are existing tests for "rule wins
  over sender", "keeps sender in same client", and "overrides sender in other client"
  (`__tests__/processInboundEmailInApp.inboundRules.test.ts:181-290`). New behaviour must keep all
  of them passing.
- **Expression-index drift.** If the engine's normalisation SQL and the index expression drift
  apart, the query silently falls back to a sequential scan. Define the SQL expression once as a
  constant in `engine.ts`, and add a comment in the migration that points to it.
- **Asset association `created_by`.** The column is NOT NULL with an FK to users. The existing
  convention is the tenant's earliest user. If a tenant has no users, skip the association; never
  fail.
- **Email tokens in extracted values.** Values such as `mailto:` links or trailing punctuation are
  handled by `extractEmailCandidate`, which needs unit cases for each.
- **Backward compatibility of stored configs.** Configs without `match_by` must behave exactly as
  before. The existing engine and validation tests act as the regression guard.
- **Partial client lookups.** The engine runs under `withAdminTransaction`, and every query must
  go through `tenantDb(trx, tenantId)` (`assets`, `contacts`, and
  `contact_additional_email_addresses` are all registered in `tenantTableMetadata.ts`).

## Verification

1. **Unit, pure** (`shared/services/email/__tests__/inboundEmailRules.evaluator.test.ts`,
   `inboundEmailRules.validation.test.ts`): `resolveMatchTargets` default, dedupe, and canonical
   order; `extractEmailCandidate` (bare address, `Name <addr>`, trailing punctuation, `mailto:`,
   no address → null); zod accepts or rejects `match_by` (empty, duplicate, unknown value, absent).
2. **Unit, engine** (`inboundEmailRules.engine.test.ts`, following the fake deps at `:36-48`):
   asset match assigns and carries `assetId`; contact-email match assigns and carries `contactId`;
   ambiguous asset → falls through to the next target, then to `on_no_match`, with the ambiguity
   in the trace; canonical order holds when several targets would match; absent `match_by` never
   calls the new matchers; `ai_classify` never calls the new matchers.
3. **Unit, pipeline** (`processInboundEmailInApp.inboundRules.test.ts`): a rule contact becomes
   the ticket contact and feeds the destination cascade; the asset association is attempted after
   ticket creation and a failure does not fail the email; `ruleClientMatchedBy` is present in
   `email_metadata`; the existing cases at `:149-400` still pass.
4. **Integration, real DB** (new
   `server/src/test/integration/inboundEmailRules.clientMatchers.integration.test.ts`, following
   the `integration-testing` skill conventions): seed two clients, assets (one unique name, one
   name duplicated across clients, one at an inactive client), and contacts (primary email,
   additional email, inactive). Assert that every matcher returns the right result or ambiguity,
   and `EXPLAIN` the asset query to confirm it uses `idx_assets_tenant_normalized_name`.
5. **Type-check and lint** for the touched packages (`shared`, `packages/integrations`,
   `server`).
6. **Manual smoke** on the wired dev server (port 3298, compose `alga-psa-local-test`):
   - Settings → Email → Inbound rules: create a rule with conditions `from_address contains
     tacticalrmm`, extract `after "Agent:"` from the body, and match against device name. Use the
     tester with a pasted Tactical alert body and confirm the "Matched client via device name"
     badge. Rename a second client's asset to the same hostname and confirm the tester shows the
     ambiguity message and no assignment.
   - Repeat with contact email and an extracted `Name <addr>` line.
   - End to end through GreenMail (`alga-inbound-email-testing` skill): send the alert email and
     confirm that the ticket is created for the right client, that the contact is the matched
     contact (for the email case), that the asset appears on the ticket's asset panel (for the
     device case), and that `email_metadata.ruleClientMatchedBy` is set.
   - Open an existing rule saved before this change: it loads with only "Client name or alias"
     ticked and behaves as before.
