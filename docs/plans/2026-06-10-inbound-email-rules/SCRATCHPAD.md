# Scratchpad — Inbound Email Rules

- Plan slug: `2026-06-10-inbound-email-rules`
- Created: `2026-06-10`

## What This Is

Rolling log of discoveries and decisions while implementing inbound email rules.
Approved design: `docs/plans/2026-06-10-inbound-email-rules-design.md` (commit fd14d3e445).

## Decisions

- (2026-06-10) Inline rules engine in `processInboundEmailInApp()`, not
  workflow-compiled and not a generic automation framework. In-app processing
  already replaced workflow-based email handling; generic framework is premature
  with one consumer.
- (2026-06-10) Tenant-wide ordered rules with optional per-rule `provider_ids`
  filter. Board is an *output* of rules (via destination/defaults), never a scope —
  board isn't known until after rules run.
- (2026-06-10) New-ticket path only; replies that thread onto tickets bypass rules
  so skip patterns can't eat genuine replies.
- (2026-06-10) Client matching is exact-normalized + per-client aliases
  (`client_name_aliases`). Fuzzy matching rejected: wrong match = ticket (and its
  contents) on the wrong client.
- (2026-06-10) `on_no_match = proceed` continues down the rules list (not straight
  to the normal pipeline) — enables "regex rule first, AI catch-all later" so AI
  only burns tokens when deterministic extraction fails.
- (2026-06-10) Rule-assigned client beats sender contact/domain matching — the
  sender is a service (e.g. alerts@huntress.com), not the client.
- (2026-06-10) AI never picks a client_id; it returns `extracted_client_name` and
  the deterministic matcher resolves it. No client list in the prompt.
- (2026-06-10) Packaging: rules engine CE; only `ai_classify` gated on EE + AI
  add-on. AI action is visible-but-disabled (upsell tease) without the add-on —
  explicit user request.
- (2026-06-10) Live tester calls the real shared evaluator via a server action; no
  parallel test implementation.

## Discoveries / Constraints

- (2026-06-10) Migration conventions: composite `(tenant, id)` PK, best-effort
  `create_distributed_table('<table>', 'tenant')`, `exports.config = { transaction:
  false }`, functional unique indexes on `lower(...)` — mirror
  `server/migrations/20260213180500_create_client_inbound_email_domains.cjs`.
- (2026-06-10) `email_processed_messages.processing_status` has a CHECK constraint
  (`success|failed|partial`) — adding `skipped` requires dropping/re-adding the
  constraint (migration `20250130200000` created it).
- (2026-06-10) Unknown senders are currently dropped as
  `skipped/missing_defaults` in `processInboundEmailInApp.ts` — running rules
  *before* defaults resolution means skip rules work for tenants with no defaults.
- (2026-06-10) EE dynamic-load pattern to copy:
  `shared/services/email/inboundReplyAcknowledgementDecider.ts` (OSS stub + EE
  module).
- (2026-06-10) Domain-match contact fallback today uses
  `findValidClientPrimaryContactId` (clients.properties.primary_contact_id) in
  `shared/workflow/actions/emailWorkflowActions.ts` — reuse for rule-assigned
  clients.
- (2026-06-10) UI home: `packages/integrations/src/components/email/` (provider
  config, `admin/InboundTicketDefaultsManager.tsx`,
  `forms/InboundTicketDefaultsForm.tsx`). Alias UI goes next to the client
  inbound-domains UI (`packages/clients/src/actions/clientInboundEmailDomainActions.ts`
  is the actions-layer sibling).

## Commands / Runbooks

- (2026-06-10) Integration tests: see `integration-testing` skill (DB bootstrap,
  tenant isolation, transaction cleanup).
- (2026-06-10) Manual smoke: dev stack + MailHog (see `alga-dev-env-manager` /
  `alga-manual-smoke-tests` skills); send sample Huntress-style email and a
  status-update email.

## Links / References

- Design doc: `docs/plans/2026-06-10-inbound-email-rules-design.md`
- Pipeline: `shared/services/email/processInboundEmailInApp.ts`
- Matching/defaults: `shared/workflow/actions/emailWorkflowActions.ts`
- Reply parsing: `shared/lib/email/replyParser.ts`
- Prior related plans: `ee/docs/plans/2026-02-13-inbound-email-domain-matching-default-contact/`,
  `ee/docs/plans/2026-02-25-inbound-email-sender-routing-to-boards/`,
  `ee/docs/plans/2026-03-31-inbound-email-reopen-on-reply/`

## Open Questions

- None blocking. Deferred (out of scope per PRD): any_of condition groups,
  apply-to-replies flag, fuzzy matching, global AI fallback rule, token billing.
