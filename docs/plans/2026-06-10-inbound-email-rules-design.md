# Inbound Email Rules — Design

## Problem

Inbound email processing (`shared/services/email/processInboundEmailInApp.ts`) matches
senders to clients by exact contact email or by sender domain
(`client_inbound_email_domains`), then creates a ticket using the
`inbound_ticket_defaults` cascade. That covers email written by humans at a client, but
not email *about* a client sent by a third-party service.

Two customer requests drive this feature:

1. A monitoring service (Huntress) emails alerts where the affected customer's name
   appears in the subject, in parentheses. The ticket should be assigned to that
   client, but the sender is `@huntress.com` — neither contact match nor domain match
   can ever resolve it.
2. Some recurring emails (status updates, notifications) should not create tickets at
   all.

Both are achievable today with workflows, but workflow executions are metered, and
authoring a regex-parsing workflow is too complex for what competing PSAs offer as
built-in configuration. Tenants with the AI add-on should additionally be able to
classify email without writing patterns at all.

## Solution overview

A tenant-wide, ordered list of **inbound email rules**, evaluated inline in
`processInboundEmailInApp()` on the new-ticket path. Each rule has:

- an optional mailbox filter (which `email_providers` it applies to)
- a set of conditions (sender, subject, body, recipients)
- one action: **skip**, **extract + assign client**, **set destination**, or
  **AI classify** (EE)
- a non-match behavior for when the action's extraction/classification fails

Rules are configured in the email settings UI with a structured condition builder, a
regex escape hatch, and a live tester that runs the production evaluator against
sample input.

Deliberately **not** built: a generic automation framework. The evaluator is a small,
email-specific module; the JSONB condition shape leaves room to generalize later if a
second consumer appears. Compiling rules to hidden system workflows was rejected —
in-app processing already replaced workflow-based email handling, and generated
workflows are hard to debug and version.

## Data model

### `inbound_email_rules` (new)

| Column | Type | Notes |
|---|---|---|
| `tenant` | uuid | composite PK `(tenant, id)`, Citus distribution column |
| `id` | uuid | default `gen_random_uuid()` |
| `name` | text | e.g. "Huntress customer routing" |
| `is_active` | boolean | default true |
| `position` | integer | evaluation order within tenant |
| `provider_ids` | jsonb | array of `email_providers.id`; NULL = all mailboxes |
| `conditions` | jsonb | ALL-of array, see below |
| `action_type` | text | `skip` \| `extract_assign_client` \| `set_destination` \| `ai_classify` |
| `action_config` | jsonb | per-type payload, see Actions |
| `on_no_match` | text | `proceed` \| `fallback_destination` \| `skip` (default `proceed`) |
| `fallback_inbound_ticket_defaults_id` | uuid | used when `on_no_match = fallback_destination` |
| `created_at` / `updated_at` | timestamptz | |

`conditions` is a flat ALL-of array. An `any_of` wrapper can be introduced later
without a migration.

```json
[
  { "field": "from_address", "operator": "contains", "value": "@huntress.com" },
  { "field": "subject", "operator": "contains", "value": "(" }
]
```

- Fields: `from_address`, `from_domain`, `to_address`, `subject`, `body_text`
- Operators: `equals`, `contains`, `starts_with`, `ends_with`, `matches_regex`
- All matching is case-insensitive; `to_address` matches if any recipient matches.

### `client_name_aliases` (new)

Same shape as `client_inbound_email_domains`: `(tenant, id)` PK, `client_id`, `alias`
(stored as typed), unique index on `(tenant, lower(alias))` so an alias resolves to
exactly one client. Both new tables follow the existing migration conventions
(best-effort `create_distributed_table`, `transaction: false` — see
`server/migrations/20260213180500_create_client_inbound_email_domains.cjs`).

### Modified

- `email_processed_messages.processing_status` check constraint gains `'skipped'`;
  `metadata` records `{ ruleId, ruleName }` for skipped email.
- `tickets.email_metadata` (existing JSONB) gains `appliedRuleId` and
  `clientMatchSource` (`rule_extraction` \| `rule_ai` \| `email_match` \|
  `domain_match`). No schema change.

## Evaluation semantics

Rules run inside `processInboundEmailInApp()` **only on the new-ticket path** — after
all thread-matching attempts fail, before `resolveInboundTicketDefaults()` and
contact/client matching. Replies that thread onto existing tickets are never touched
by rules, so a broad skip pattern cannot swallow a genuine customer reply. A side
effect: skip rules work even for tenants with no inbound defaults configured (today
such email drops as `missing_defaults`).

The loop:

1. Load the tenant's active rules ordered by `position`; keep those whose
   `provider_ids` is NULL or contains the receiving provider.
2. Walk the list; the first rule whose conditions all match executes its action.
3. If the action **resolves** (skip decided, client assigned, destination set), stop
   and continue the pipeline with that outcome.
4. If the action's extraction/classification **fails to match**:
   - `on_no_match = proceed` → continue down the rules list. This enables the
     intended pattern "deterministic extraction rule first, AI catch-all later" —
     the AI rule only spends tokens when regex fails.
   - `on_no_match = skip` → stop; email skipped.
   - `on_no_match = fallback_destination` → stop; ticket created at the referenced
     `inbound_ticket_defaults` destination for human triage.
5. If no rule matches or resolves, the pipeline behaves exactly as today. Tenants
   with no rules see zero behavior change.

### Precedence of a rule-assigned client

A client assigned by a rule **wins over sender-based matching**. The premise of the
extraction case is that the sender is a service, not the client, so an accidental
exact-email contact match must not override the rule. Contact attribution within the
assigned client: if the sender email matches a contact in that client, use it;
otherwise the client's primary contact (mirroring today's domain-match behavior in
`findValidClientPrimaryContactId`). Destination still flows through
`resolveEffectiveInboundTicketDefaults()` with the rule-assigned client, so a
client-level `inbound_ticket_defaults_id` override applies as usual.

### Regex safety

`matches_regex` patterns are length-capped and compiled in try/catch (invalid pattern
= condition false, logged once per rule per process). Inputs are length-bounded
(body sliced to ~100 KB). Rules load with one indexed query per email.

## Actions

### `skip`

No config beyond an optional note. Writes the `email_processed_messages` row with
`processing_status = 'skipped'` and rule metadata. No ticket, comment, or attachment
processing.

### `extract_assign_client`

```json
{
  "source": "subject",
  "extraction": {
    "type": "between",
    "start": "(", "end": ")",
    "occurrence": "first",
    "regex": "..."
  }
}
```

- `source`: `subject` | `body_text`
- `extraction.type`: `between` | `after` | `before` | `regex`. The friendly
  templates compile to the same internal extractor as raw regex — one code path.
  `regex` uses capture group 1.
- `occurrence`: `first` | `last`, for repeated delimiters.

The extracted value is normalized (trim, collapse whitespace, lowercase) and matched
first against `clients.client_name` (normalized), then `client_name_aliases`.
Inactive clients are excluded. No match → the rule's `on_no_match`.

### `set_destination`

`{ "inbound_ticket_defaults_id": "..." }` — applies the referenced defaults set at
the top of the destination cascade (above contact override). Normal sender matching
still runs for client/contact attribution. Reuses the existing defaults entity
rather than inventing a parallel destination shape.

### `ai_classify` (EE)

`{ "instruction": "...", "allowed_outcomes": ["skip", "assign_client"] }`

The model never picks a `client_id` directly — **it extracts, the deterministic
matcher resolves**. The EE module receives subject/from/body-excerpt plus the
tenant's instruction and returns constrained JSON:

```json
{ "decision": "skip" | "assign_client" | "no_decision", "extracted_client_name": "..." }
```

An `assign_client` decision runs the extracted name through the same exact+alias
matcher as regex extraction, so AI and regex rules share identical matching and
audit semantics, no client list is sent in the prompt, and hallucinated assignment
is impossible.

Wiring follows the `inboundReplyAcknowledgementDecider` pattern
(`shared/services/email/inboundReplyAcknowledgementDecider.ts`): OSS ships a stub
returning `no_decision`; EE dynamically loads the real module. Any AI failure
(timeout, error, missing add-on) is a non-match → `on_no_match`. Ticket creation
never blocks on AI availability. Token usage is logged through the AI module's
existing usage tracking so metering can be added later without schema changes.

## UI

A new **Inbound Rules** section in email settings, alongside the provider list and
`InboundTicketDefaultsManager`
(`packages/integrations/src/components/email/`). Same RBAC as email provider
administration.

- **Rules list**: ordered table — drag to reorder (persists `position`), name,
  human-readable summary ("From contains @huntress.com → assign client from
  subject"), mailbox-filter chips, active toggle, edit/delete.
- **Rule editor** (drawer): name, active, mailbox multi-select; condition rows of
  field + operator + value (`matches regex` is just another operator — the escape
  hatch needs no separate mode); action picker; per-action config (extraction
  source + template inputs, destination picker, AI instruction + allowed-outcome
  checkboxes); non-match behavior select with fallback destination picker.
  The AI action is always visible; without EE + AI add-on it renders disabled with
  an upsell hint.
- **Live tester**: paste sample From/Subject/Body; a server action runs the *actual
  shared evaluator* against the draft rule and shows each condition's pass/fail,
  the extracted value, the resolved client (or no match), and the final outcome.
  There is no separate test implementation to drift from production.
- **Alias management**: a "Matching aliases" list on the client record next to the
  inbound email domains UI, plus a shortcut in the tester — when extraction
  succeeds but no client matches, offer "Add *<value>* as an alias of…" with a
  client picker.

## Error handling and observability

- Rule evaluation is wrapped so an engine error (bad JSONB shape, regex compile
  failure, alias query error) never kills email processing — it logs a warning with
  the rule id and falls through to the unmodified pipeline. A misconfigured rule
  degrades to "no rules", not to dropped email.
- Dangling references (deleted defaults set or client behind an alias) → treated as
  non-match/proceed with a warning. UI pickers filter to active records.
- Skipped email is answerable from existing diagnostics: the
  `email_processed_messages` row carries the rule id/name.
- Created tickets carry `appliedRuleId`/`clientMatchSource` in `email_metadata`, and
  the existing `INBOUND_EMAIL_RECEIVED` activity-log row includes the rule name.
- The engine emits one structured log line per evaluated email: rules considered,
  rule matched, outcome.

## Packaging

The rules engine (skip, extraction, destination, aliases, UI) ships in CE. Only the
`ai_classify` rule type is gated on EE + the AI add-on, matching how AI ack
suppression is packaged.

## Testing

- **Unit** (bulk of coverage): the evaluator is a pure function — condition
  matching per field/operator, extraction templates and edge cases (missing
  delimiters, repeated delimiters, unicode, empty capture), normalization, alias
  resolution, first-match/`proceed` chaining, regex-safety guards.
- **Integration**: full `processInboundEmailInApp()` runs against seeded rules —
  skip outcome, extract+assign end-to-end including precedence over a sender
  contact match, non-match fallback destination, no-rules regression (pipeline
  unchanged), OSS AI-stub behavior.
- **Manual smoke**: UI flow — create a rule via the builder, exercise the live
  tester, reorder rules, alias quick-add — against the dev email tooling
  (MailHog).

## Out of scope (future)

- `any_of` condition groups (JSONB shape already accommodates them)
- Per-rule "also apply to replies" flag
- Fuzzy client-name matching (rejected for v1: a wrong match assigns a ticket to
  the wrong client)
- A pre-seeded global AI fallback rule
- AI token metering (usage is already logged; billing integration comes later)
