# Entra/CIPP contact sync: email ownership and cross-client conflicts

Card: `37167590` — "Entra/CIPP contact sync: handle emails already on a contact at another client,
and name the conflicting contact (PBNJ alga-2026-0003070)"
Step: Design Session (conn, delegated desk) → next: Link Spec to PSA Ticket
Author: XO, 2026-11-18

## 1. Problem, stated correctly

Three asks come from one missing mechanism: **nothing in the product can answer "who owns this
email address in this tenant, and what should happen when the owner sits at another client?"**

Today the same fact is computed in four places, at four different fidelities, and the one place
that *write* depends on computes it worst:

| # | Site | What it knows |
|---|---|---|
| 1 | `shared/models/contactModel.ts:859-867` | `createContact` looks up `contacts.email` in the tenant and throws `EMAIL_EXISTS: A contact with this email address already exists in the system` — no owner, no client |
| 2 | `shared/models/contactModel.ts:436-472` (`contactEmailConflictMessage`) | the same strings again for the DB-constraint race path (primary, additional-email, cross-kind) |
| 3 | `ee/server/src/lib/integrations/entra/sync/contactReconciler.ts:201-216` (`findExistingClientContactByEmail`) | only contacts whose `client_id` equals the client being synced |
| 4 | `packages/clients/src/actions/contact-actions/contactActions.tsx:197-230` + `:275/:342`, and a second inline copy at `packages/clients/src/actions/queryActions.ts:624-640` | per-caller ad-hoc lookup that names the client (and only for that caller's path) |

Consequences today: `createContactForEntraUser` (contactReconciler.ts:378-455) resolves "same client"
and then calls `createContact`, which throws for an owner *anywhere else* in the tenant; `syncEngine.ts:256`
does not catch it, so one such user aborts the rest of that client's sync. And the two paths that do
look up a cross-client owner are private helpers, so the Entra path and the model path can never name
the owner.

The ticket asks for three behaviours (sync decides deliberately, errors name the owner, manual add
names the owner). They are one resolver and one conflict value away from all three being true.

## 2. Decisions

### D1 — One ownership resolver

New `shared/models/contactEmailOwnership.ts`:

```ts
export type ContactEmailOwnerKind = 'primary' | 'additional';
export interface ContactEmailOwner {
  kind: ContactEmailOwnerKind;
  contactNameId: string;
  clientId: string | null;
  fullName: string;
  clientName: string | null;   // null when the contact has no client
  isInactive: boolean;
}
export async function resolveContactEmailOwnership(
  tenantId: string, email: string, trx?: Knex.Transaction
): Promise<ContactEmailOwner | null>;
```

It checks `contacts.email` (normalized) and `contact_additional_email_addresses.normalized_email_address`,
in that order (primary wins ties), tenant-scoped, reads only. It makes **no permission judgement** —
it returns ids and names; the caller decides what the subject may see (D6).

### D2 — The model throws a structured conflict

`ContactModel.createContact` calls `resolveContactEmailOwnership` before its current lookup and throws
`EmailOwnershipError` (new class in the same module) carrying `.conflict: ContactEmailOwner`. The message
keeps its `EMAIL_EXISTS: ` prefix and today's generic text so every existing string match still works
(`shared/workflow/.../contacts.ts:262`, `emailWorkflowActions.ts:833`, `contactActionErrorCodes.ts:13`),
but the detail is now available to any caller that wants it. The constraint-race path
(`contactEmailConflictMessage`, contactModel.ts:436-472) resolves the owner at throw time and produces the
same structured error, so a race cannot degrade the message.

### D3 — Sync behaviour (the product decision)

In `createContactForEntraUser`, before creating:

- **Owner at the same client** (any kind) → link, as today, extended to additional-email matches; reactivate
  when inactive. This is the existing `findExistingClientContactByEmail` outcome plus the additional-email case.
- **Owner at a different client, or at no client** → **never auto-link.** Queue a reconciliation item and skip
  this user; the rest of the client's users continue.
- **Owner inactive at the same client** → link + reactivate (already the shared-mailbox pattern).

Rationale for refusing cross-client linking: a contact's `client_id` is its visibility boundary — auto-linking
would attach one client's person to another client's record, exposing them in the second client's contacts and
portal. The operator is the only one who can say "this person really does belong to both". Queuing is what the
engine already does when matching is ambiguous (D5), so it is the same operator workflow, not a new one.

### D4 — The reconciler returns a conflict instead of throwing

`createContactForEntraUser` gains `action: 'conflict'` with the owner payload, and never throws `EMAIL_EXISTS`.
This makes the sync continue regardless of whether PR #4398 (per-contact failure handling) has merged — the
design does not depend on it; once #4398 lands, queued conflicts simply also count in its summary.

### D5 — One queue, one new reason

Reuse `entra_contact_reconciliation_queue` (`reconciliationQueueService.ts`). Its payload already carries a
`reason` (`multiple_email_matches`, line 63) and serialized candidates; add:

- `reason: 'email_owned_by_other_client'`, candidates = the owning contact (id, name, clientId, clientName,
  kind, isInactive);
- surface `reason` and `owner` on `EntraReconciliationQueueItem` (today the interface at
  `reconciliationQueueService.ts:22-35` drops `reason`, so the operator UI cannot tell the two kinds apart);
- operator resolution: **link anyway** (explicit, audited: writes the `entra_contact_links` row and a note
  naming the operator decision) or **dismiss/skip** (existing dismiss path, line ~174, reason noted).

Dedupe stays as it is: one open item per `entra_tenant_id` + `entra_object_id`.

### D6 — Every path names the owner, within the caller's scope

New shared formatter `describeContactEmailConflict(conflict, clientVisible: boolean, t)` producing:
"…already belongs to *Full Name* at *Client*" / "…at another client" (client not visible to the subject) /
"…to an inactive contact" / "…as an additional email address on *Full Name*".

- `contactActions.tsx:197` (`contactEmailConflictMessageFrom`) becomes a thin wrapper over the resolver +
  formatter — it currently re-derives the client name itself.
- `queryActions.ts:624-640` drops its inline duplicate and uses the same pair.
- Visibility is decided once, by the caller: a client the subject cannot read is named only as "another client".
  Reuse the existing read-scope check used by contact actions (`assertRecordReadAllowed` for `contact`).
- `QuickAddContact.tsx:371`/`:450`/`:560` and `ContactDetailsEdit.tsx:332` already render the detail string, so
  they need no change — the point is that they now receive a specific one. This also answers the card's
  "generic error on manual add" by construction: no path can produce the bare generic text any more.

### D7 — Report the conflict

Add a `conflict` counter to the sync summary (`preflightService.ts` summary type, `syncState` counters) and name
it in the existing review-queue notification rule (`entraSyncNotificationRules.ts:108`) — "N identities are
already a contact at another client; review them". A skipped user must be visible in the run report, not silent.

### Non-goals

- No change to the unique indexes or the additional-email trigger (the schemas are the truth; the code learns to
  read them).
- No contact merging and no cross-client linking on any automatic path.
- No dependency on PR #4398; no new email normalization rules beyond trim + lower (already the tenant rule).
- No change to portal-user (`users.email`) handling — out of this card's evidence.

## 3. Work groups

**G1 — ownership resolver.** `shared/models/contactEmailOwnership.ts` + tests: primary hit, additional hit,
same email in both (primary wins), no client, inactive, case/whitespace, tenant isolation.

**G2 — model conflict.** `createContact` throws `EmailOwnershipError` with `.conflict`; constraint-race path
resolves the owner; keep the message prefix. Tests in the contact-model suite: primary conflict, additional
conflict, race path, no-conflict still creates.

**G3 — reconciler.** Cross-client/no-client → `queueAmbiguousContactMatch`-style item with
`email_owned_by_other_client` and `{action:'conflict'}` return; same-client additional-email owner links;
inactive same-client links + reactivates. Tests: each branch, plus "sync continues for the remaining users".

**G4 — queue surfacing.** `reason` + `owner` on the item interface and the list API; "link anyway" resolution
writing the link with an audit annotation; dismiss unaffected. Tests: round-trip, dedupe, link-anyway writes
the link and closes the item.

**G5 — message + manual paths.** Shared formatter, `contactActions.tsx` and `queryActions.ts` wired to it,
read-scope redaction. Tests: cross-client named, cross-client redacted for an out-of-scope subject,
additional-email wording, inactive wording (extend `contactActions.emailConflict.test.ts`).

**G6 — reporting.** `conflict` counter in the summary + notification line; test the summary shape and the
notification text.

## 4. Verification

- Targeted vitest: contact model, `contactReconciler`, `reconciliationQueueService`, `contactActions.emailConflict`,
  `queryActions` contact paths, `entraSyncNotificationRules`.
- `tsc --noEmit` for `shared`, `packages/clients`, `ee/server`.
- Manual: a dry-run sync preview lists the conflicting user under conflicts and creates nothing; a real sync
  completes the client's other users; the queue shows the owner with client name; manual add of the same email
  names the owner.

## 5. Risks

1. **Information disclosure.** Naming a client a subject cannot read leaks tenant structure. Mitigated by D6's
   single visibility decision at the caller; every other path inherits it rather than re-deciding.
2. **Behaviour change for same-client additional emails.** These used to fail; they now link. Intended and
   tested — it is the same person by the tenant's own rule.
3. **Operator load.** A tenant with many shared addresses could queue many items. Mitigated by the existing
   dedupe (one open item per Entra object) and by the notification summary naming the count.
4. **Two writers of the same fact.** If a later caller bypasses the resolver and formats its own message, D6's
   formatter is bypassed too. Guarded by keeping the model's throw structured — a caller that only reads
   `error.message` still gets a specific message.
