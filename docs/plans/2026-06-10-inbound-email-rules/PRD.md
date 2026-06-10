# PRD — Inbound Email Rules

- Slug: `2026-06-10-inbound-email-rules`
- Date: `2026-06-10`
- Status: Accepted — core implementation landed 2026-06-10
- Design: [../2026-06-10-inbound-email-rules-design.md](../2026-06-10-inbound-email-rules-design.md)

## Summary

A tenant-wide, ordered list of inbound email rules evaluated inside
`processInboundEmailInApp()` on the new-ticket path. Rules match on
sender/subject/body/recipients and perform one action: skip the email, extract a
client name from the subject/body and assign the matching client, route to a
destination (`inbound_ticket_defaults` set), or classify with AI (EE add-on).
Configured through an intuitive builder UI with a regex escape hatch and a live
tester that runs the production evaluator.

## Problem

Inbound email can only be attributed to a client by exact sender-contact match or
sender-domain match. Email *about* a client sent by a third-party service (e.g.
Huntress alerts with the customer name in the subject) cannot be routed, and noisy
service email (status updates) always creates tickets. Workflows can do both, but
executions are metered and authoring is too complex versus competitors' built-in
configuration.

## Goals

- Assign tickets to the right client by extracting a name from the subject/body
  (the Huntress case), with safe exact+alias matching.
- Suppress ticket creation entirely for configured email (status updates).
- Route matched email to a chosen destination (board/status/priority via
  `inbound_ticket_defaults`).
- Let AI add-on tenants classify email (skip / assign client) with a natural-language
  instruction instead of patterns; token-meterable later.
- Intuitive UI: condition builder, friendly extraction templates, regex escape
  hatch, live tester, drag reordering.
- Zero behavior change for tenants with no rules.

## Non-goals

- Generic automation framework beyond inbound email.
- Rules on the reply/threading path (replies always become comments).
- Fuzzy client-name matching.
- `any_of` condition groups (JSONB shape accommodates them later).
- AI token billing integration (usage logged only).
- Compiling rules to workflows or any workflow-engine involvement.

## Users and Primary Flows

MSP administrators (email settings RBAC).

1. **Huntress routing**: admin creates a rule — conditions `from_address contains
   @huntress.com`; action *extract + assign client*, text between `(` and `)` in
   subject; non-match → fallback destination "Triage". Alerts now land on the right
   client; unknown names land in Triage where the tester's alias quick-add teaches
   the system.
2. **Status-update suppression**: admin creates a skip rule on subject
   `contains "status update"` scoped to one mailbox. Those emails create nothing and
   are auditable as `skipped` in email diagnostics.
3. **AI catch-all**: admin with the AI add-on adds a final rule for
   `@huntress.com` email: AI classify with instruction "determine which customer
   this alert concerns". Deterministic rules run first; AI only spends tokens when
   they fail.

## UX / UI Notes

New **Inbound Rules** section in email settings
(`packages/integrations/src/components/email/`), same RBAC as provider admin.

- Rules list: ordered table, drag-to-reorder (persists `position`), name,
  human-readable summary, mailbox-filter chips, active toggle, edit/delete.
- Rule editor drawer: name; active; mailbox multi-select (empty = all); condition
  rows (field + operator + value, `matches regex` is an ordinary operator); action
  picker; per-action config; non-match behavior select with fallback destination
  picker. The AI action is always visible; without EE + AI add-on it is disabled
  with an upsell hint.
- Live tester: paste From/Subject/Body; a server action runs the actual shared
  evaluator on the draft rule and shows per-condition pass/fail, extracted value,
  resolved client, final outcome. When extraction matches but no client resolves,
  offer "Add *<value>* as an alias of…" with a client picker.
- Client record: "Matching aliases" list next to the inbound email domains UI.

## Requirements

### Functional Requirements

1. **Data**: `inbound_email_rules` and `client_name_aliases` tables per the design
   doc (composite `(tenant, id)` PKs, Citus distribution, `transaction: false`);
   `email_processed_messages.processing_status` check constraint gains `'skipped'`.
2. **Conditions**: ALL-of array; fields `from_address`, `from_domain`, `to_address`
   (any recipient), `subject`, `body_text`; operators `equals`, `contains`,
   `starts_with`, `ends_with`, `matches_regex`; case-insensitive; regex
   length-capped, compile errors = condition false; body input sliced (~100 KB).
3. **Evaluation**: new-ticket path only, after thread matching fails, before
   defaults resolution. Active rules ordered by `position`, filtered by
   `provider_ids`. First conditions-match executes the action; resolved action
   stops; non-match honors `on_no_match` (`proceed` continues down the list;
   `skip`; `fallback_destination`). No match → today's pipeline unchanged.
4. **Skip action**: no ticket/comment/attachments; `email_processed_messages` row
   `processing_status='skipped'` with `{ ruleId, ruleName }` metadata. Works for
   tenants with no inbound defaults.
5. **Extract + assign**: templates `between`/`after`/`before` (with
   `occurrence` first/last) and raw `regex` (capture group 1) compile to one
   extractor; extracted value normalized (trim, collapse whitespace, lowercase);
   matched against `clients.client_name` then `client_name_aliases`; inactive
   clients excluded. Assigned client wins over sender-based matching; contact =
   sender contact within that client, else primary contact; destination flows
   through `resolveEffectiveInboundTicketDefaults()` with the assigned client.
6. **Set destination**: applies the referenced `inbound_ticket_defaults` at the top
   of the cascade; sender matching still attributes client/contact.
7. **AI classify (EE)**: instruction + `allowed_outcomes`; OSS stub returns
   `no_decision` (dynamic loader, `inboundReplyAcknowledgementDecider` pattern); EE
   module returns `{ decision, extracted_client_name }`; `assign_client` resolves
   through the same exact+alias matcher; any failure = non-match; usage logged via
   existing AI usage tracking.
8. **Audit**: created tickets carry `appliedRuleId` and `clientMatchSource` in
   `email_metadata`; the `INBOUND_EMAIL_RECEIVED` activity-log row includes the
   rule name; one structured log line per evaluated email.
9. **Management**: CRUD + reorder server actions with payload validation per
   action type; test-rule action (no persistence); alias CRUD; all behind email
   admin RBAC.

### Non-functional Requirements

- An engine error never blocks email processing — log and fall through to the
  unmodified pipeline.
- Dangling references (deleted defaults set, deleted/inactive client behind an
  alias) degrade to non-match/proceed with a warning.
- One indexed query loads a tenant's rules per evaluated email.
- Rules engine ships CE; only `ai_classify` is EE + AI-add-on gated.

## Data / API / Integrations

See design doc for full schemas. Key integration points:

- `shared/services/email/processInboundEmailInApp.ts` — evaluation hook
- `shared/workflow/actions/emailWorkflowActions.ts` — client/contact matching,
  defaults cascade
- `shared/services/email/inboundReplyAcknowledgementDecider.ts` — EE loader pattern
- `server/migrations/20260213180500_create_client_inbound_email_domains.cjs` —
  migration conventions to mirror
- `packages/integrations/src/components/email/` — settings UI home

## Security / Permissions

Same RBAC as email provider administration for all rule/alias CRUD and the tester
action. Regex inputs are tenant-supplied: length caps and bounded inputs guard
against ReDoS. AI prompts include only the email excerpt and the tenant's
instruction — never the tenant client list.

## Observability

Covered by functional requirement 8 (skipped-email diagnostics, ticket
`email_metadata` audit fields, structured evaluation log line). Nothing further.

## Rollout / Migration

Purely additive migrations; no backfill. Feature is inert until a tenant creates a
rule. No feature flag needed.

## Open Questions

None — design decisions were settled and approved in the design doc.

## Acceptance Criteria (Definition of Done)

- A Huntress-style email (`alerts@huntress.com`, subject `Alert (Acme Corp) — ...`)
  creates a ticket assigned to client Acme Corp via a builder-authored rule, with
  `clientMatchSource: 'rule_extraction'` in `email_metadata`.
- The same rule with an unknown customer name lands the ticket at the configured
  fallback destination (or proceeds/skips, per rule config).
- A skip rule suppresses ticket creation and the email is visible as `skipped`
  with the rule name in `email_processed_messages`.
- An AI rule (EE) skips or assigns per its instruction; in OSS the same rule
  degrades to its non-match behavior; AI outages never block ticket creation.
- Replies threading onto existing tickets are unaffected by any rule.
- A tenant with no rules has byte-identical pipeline behavior.
- Rules are manageable (create/edit/reorder/toggle/delete/test) in email settings;
  aliases manageable on the client record and via tester quick-add.
- Unit + integration tests in `tests.json` pass.
