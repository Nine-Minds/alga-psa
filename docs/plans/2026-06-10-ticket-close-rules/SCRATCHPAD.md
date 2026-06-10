# Scratchpad — Ticket Close Rules

- Plan slug: `2026-06-10-ticket-close-rules`
- Created: 2026-06-10
- Design doc: `docs/plans/2026-06-10-ticket-close-rules-design.md`

## Decisions

- (2026-06-10) Per-board scope for all rules — matches statuses/SLA/email settings scoping.
- (2026-06-10) Hard block + `ticket:close_override` permission; overrides audit-logged with failure list.
- (2026-06-10) Client portal **exempt** from gates (customers can't satisfy internal-hygiene conditions) but gets the closure-recording fix; portal bypass audit-logged.
- (2026-06-10) Auto-close engine = single 15-min recurring scan via `IJobRunner` (Temporal EE / pg-boss CE). Per-ticket Temporal workflows rejected: CE would still need the scan, inactivity resets need signal plumbing across every comment path (SLA Temporal workflow already grew a self-healing poll for this drift), config changes invalidate in-flight timers. `ticket_auto_close_state` is engine-agnostic if we ever swap.
- (2026-06-10) Template items are **copied** onto tickets (provenance via `template_id`), never referenced — template edits must not mutate history. Idempotency key = template_id present among ticket's items.
- (2026-06-10) `closed_by = null` for auto-closes; attribution via audit row (`actor_type: 'system'`, `source: 'system'`). No dedicated system user UUID exists in the codebase.
- (2026-06-10) Checklist accountability = permanent `completed_by`/`completed_at` displayed inline, no confirm dialog; uncheck clears but audit preserves prior signoff.
- (2026-06-10) Test strategy 80/20: automated tests own logic/data correctness (units, integration, races, tenant isolation, regressions — 37 tests); screen flows, job wiring, and i18n moved to the risk-framed manual pass in `SMOKE_TESTS.md`. Former T034 folded into T032; T036/T038–T045/T048 replaced by smoke flows.

## Discoveries / Constraints

- No pre-close validation exists anywhere today; only idempotency guards in workflow `tickets.close` and the "closed status can't be board default" config constraint (`packages/reference-data/.../statusActions.ts:161`).
- Four open→closed flip detection sites must be wired: `ticketActions.ts` updateTicket (~724–1064), `optimizedTicketActions.ts` updateTicketInTransaction (~2386–2442), `TicketService.ts` update (1188–1221), portal `client-tickets.ts` updateTicketStatus (712, currently doesn't even set closure fields — known gap, fixed by F029).
- Resolution comment markers: `comments.is_resolution` boolean AND `metadata->>'closes_ticket'` (set by the TicketDetails close-with-comment flow at `optimizedTicketActions.ts:2734`). Gate accepts either. The close-flow inserts the comment **before** the status update, so gate ordering works naturally.
- Time entry linkage: `time_entries.work_item_id` + `work_item_type = 'ticket'`.
- Bundles: inline `tickets.master_ticket_id`, no join table. Open child = `closed_at IS NULL`.
- Board settings dialog pattern to copy: inbound-reply-reopen bordered section in `BoardsSettings.tsx` (~1139–1218); status list uses up/down buttons, not DnD — reuse for template item ordering.
- New settings tab goes in `TicketingSettings.tsx` `TICKETING_TAB_IDS`, not the top-level `SettingsPage.tsx`.
- Job model: `reconcile-bucket-usage` registration in `registerAllHandlers.ts` (~266–275) + per-tenant cron loop in `initializeScheduledJobs.ts`.
- Notification template model migration: `20250226090000_add_credit_expiration_notification.cjs`. Subtype `name` string must exactly match what's passed to `sendNotificationIfEnabled`.
- Audit: `writeTicketActivity` (`shared/lib/ticketActivity/`), event constants in `types.ts`, rendering in `TicketActivityTimeline.tsx`. Actor types include `system`; sources include `system` and `client_portal`.
- RBAC: `hasPermission(user, resource, action)` from `packages/authorization/src/rbac.ts`; permission seed model `20250619120000_add_comprehensive_permissions.cjs`.
- 422 pattern: throw `ValidationError('...', details)` → `ApiBaseController` serializes with HTTP 422.
- Workflow action registry: `getActionRegistryV2().register` in `registerTicketActions()`; next free action ID is A09.

## Commands / Runbooks

- Migrations: `cd server && npx knex migrate:latest --knexfile knexfile.cjs` (verify env first; see alga-env-manager skill for per-worktree DB creds).
- Dev stack for this worktree: alga-dev-env-manager / alga-env-manager skills.

## Links / References

- Design doc: `docs/plans/2026-06-10-ticket-close-rules-design.md` (commit 1a64dccb0d)
- Prior art for plan format: `docs/plans/2026-05-15-outbound-webhooks-for-projects/`

## Open Questions

- Required-fields allowed set frozen at category/subcategory/priority/assignee for v1 — revisit if customers ask for custom fields.
- Mobile/REST checklist CRUD endpoints deferred (non-goal §3) — revisit when mobile wants checklists.
- Email-created tickets: confirm during F017 which creation path inbound email uses so auto-apply hooks it exactly once.
