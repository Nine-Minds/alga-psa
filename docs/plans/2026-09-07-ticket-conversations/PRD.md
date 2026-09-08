# PRD — Ticket conversations, vendor email, sharing and AI synthesis

- Slug: `ticket-conversations`
- Date: 2026-09-07
- Status: Planned from the agreed design; implementation has not begun.
- Selected UI: **Option C — persistent conversation navigator**.
- Dependency: [Co-Managed IT](../2026-09-06-co-managed-it-plan.md), branch `feature/co-managed-it`.
- Checklists: [features.json](features.json), [tests.json](tests.json). Working evidence: [SCRATCHPAD.md](SCRATCHPAD.md).

## 1. Summary and problem

A ticket can require several simultaneous exchanges: requester updates, vendor support, joint IT troubleshooting, organization-private notes, and optional AI assistance. A single comment stream makes recipients and audiences difficult to distinguish. Copying information between tools loses context; forwarding whole histories risks disclosing internal material.

Introduce named conversations on one authoritative ticket. Keep the requester exchange front and center by default. Make switching obvious, label the active audience, route replies to the correct conversation, and deliberately share selected messages or AI-generated whole-conversation summaries through an editable destination draft.

The capability works for ordinary MSP tickets and co-managed tickets. Co-managed IT supplies qualified identities, resource authority, organization ownership, three audiences, and protected content operations. This card extends those foundations; it does not create a second shared-ticket permission system.

## 2. Goals and boundaries

### Goals

- Keep simple requester-only tickets simple while supporting multiple external/internal exchanges on one ticket.
- Make what is visible, what is emailed, and who receives internal notifications distinct and predictable.
- Preserve organization and requester boundaries across UI, email, attachments, AI, search, notifications and export.
- Enable selective message sharing and complete-conversation synthesis to either an existing or a new conversation on the same ticket.
- Preserve existing requester email/reopen behavior, comment history, attribution, reply relationships, attachments, SLA meaning and ticket layout preferences.

### Non-goals

- Individually restricted technician conversations or invitation-based access within an organization; revisit separately.
- New SMS, Teams or other transport integrations; independent ticket copies for vendor exchanges; cross-ticket sharing.
- Autonomous external AI sending, AI tools that modify ticket business state, automatic summaries on every reply, or a separate AI workbench.
- Sharing all history automatically, granting vendor portal access, or replacing ordinary ticket/relationship permissions with email participant lists.
- A general-purpose collaboration platform refactor, a new monitoring/analytics program, new commercial packaging, or redesign of the whole client portal.
- Collaborative editing of one draft, draft handoff between technicians, new conversation scheduling semantics, or new email-policy knobs beyond the agreed side-reply opt-in. Preserve supported existing scheduled-comment behavior.

## 3. Users and primary flows

1. **Ordinary service-desk technician:** open a ticket, read the requester exchange, compose and send a reply using existing workflow. Additional conversations appear only when useful.
2. **Technician coordinating a vendor:** create a named external email conversation, choose explicit recipients, send from an authorized organizational mailbox, and receive correlated replies there. New vendor colleagues can participate by email without application access.
3. **Co-managed IT collaborators:** work on the same customer-owned ticket in requester-facing or Shared IT conversations while each organization retains its private notes and vendor conversations.
4. **Technician sharing a useful message:** select a vendor/internal/AI message, choose a destination, optionally quote and select attachments, edit the private draft, preview recipients and send/post deliberately.
5. **Technician synthesizing a conversation:** choose the entire source conversation and the intended destination/audience before generation, obtain a private audience-appropriate draft, edit and explicitly publish. Creating a new requester-directed conversation is supported as well as using the default requester exchange.
6. **Technician consulting AI:** explicitly ask in an internal/AI conversation. AI uses only context permitted for that conversational audience; an outward answer is prepared as a separate reviewed draft.
7. **Requester/portal user:** see and reply only to requester-facing conversations available through existing ticket access. Side conversations, private metadata, AI exchanges, and draft/provenance details do not appear.

## 4. Conversation and access model

### 4.1 Independent dimensions

A **conversation** is a named container of published messages and reply relationships on a ticket. A **reply thread/root** remains a relationship within that container. Existing `comment_threads` records are not equivalent to named conversations.

Keep these dimensions separate:

| Dimension | Meaning |
| --- | --- |
| Resource access | Existing right to read/update the authoritative ticket, including relationship scope and lifecycle. |
| Audience | Requester-facing, Shared IT, or organization-private; inherited by messages and attachments. |
| Storage ownership | Customer-owned shared/requester history versus authoring-organization private history. |
| Participant capability | Qualified internal human, external email correspondent, requester/contact, or AI author; does not itself confer ticket access. |
| Transport | External email versus internal application posting. AI is an author/invocation capability, not an email transport. |
| Email envelope | Explicit To/CC and authorized From/Reply-To for a particular outgoing message. |
| Subscription | Internal notification preference for a currently authorized viewer. |
| Draft ownership | Qualified author plus destination; unpublished and invisible to other collaborators. |

Each ticket has exactly one default requester conversation. Further requester-facing conversations are allowed but never replace that default implicitly. Internal and vendor conversations can be added as needed. AI assistance is opt-in; ordinary tickets need not pre-create an AI conversation.

### 4.2 Audience and ownership matrix

| Conversation | Authorized application readers/posters | Storage and external delivery |
| --- | --- | --- |
| Default/additional requester-facing | Existing authorized requester/portal readers plus authorized technicians; writing still requires the applicable role/action. | Ticket-owning tenant; explicit requester email uses the owning workspace mailbox. |
| Shared IT | Authorized technicians in both participating organizations; excludes requester/portal. | Customer-owned shared history; internal posts do not email external recipients. |
| Organization-private internal/AI | Authorized technicians in the owning organization who also have ticket access. | Private owner's store; no external email from Post or Ask AI. |
| Vendor external email, organization-private | Same private organizational access, with external correspondents participating only through their email exchange. | Originating organization's store/mailbox; vendors receive explicitly sent content and selected files only. |
| Vendor external email, Shared IT | Authorized technicians in both organizations can read; sending also needs explicit mailbox authority. | Shared/customer-owned conversation history; originating mailbox ownership persists independently. |

Ordinary MSP tickets use native tenant permission rules and equivalent requester/private semantics. They must not require a co-managed relationship or license to use vendor conversations. Cross-organization Shared IT choices apply only where an authorized relationship exists.

Never switch the actor's home identity to the customer's tenant. Reuse the parent's qualified identity, content redactions, relationship/lifecycle and operational-write checks. Organization membership alone is insufficient without ticket access. Sponsorship, assignment or administrative delegation cannot override another organization's private audience.

### 4.3 Visibility changes and lifecycle

Audience changes require existing disclosure authority, explicit confirmation of the history/files being disclosed, and current audience revision validation. Changing conversation text, following it, adding an email recipient, or handing back responsibility never widens visibility. Use the parent's disclosure/transfer semantics across stores rather than an in-place flag flip on MSP-private data. Do not offer a misleading re-privatization action that claims to recall already shared history.

On revoked access, hide names, unread counts, snippets, files and draft content and reject subsequent operations. Recheck authority on generation, publication, downloads, queued email delivery and realtime fanout. In-flight responses must not restore data after a persona/session/resource change. Relationship termination, retained archives, suspension, export and deletion continue to follow the parent plan's ownership rules; private vendor and AI artifacts must join the same selection rules.

## 5. UX — option C

### 5.1 Layout and navigation

Use the existing Alga ticket shell: ticket hero and editable ticket fields above, conversation in the wide center column, compact contextual cards around it. Add a persistent **Conversations** navigator at the top of the left context column, above contact/client details. Keep existing status, priority, assignee, SLA, time, checklist and document controls.

Pin the default **Requester** conversation first. Place supporting conversations below it with readable names and audience subtitles. Each row indicates the active selection, unread/attention count, Open/Done state, and whether the current author has a draft. Include **New conversation** and **All activity**. Hide all inaccessible rows and counts rather than showing locked private titles. A requester-only ticket presents a compact list, not empty placeholders for vendor/AI work.

The center heading identifies the conversation, its audience and transport. Show email recipients and From in the composer; do not use audience color alone to convey delivery. Use the current Alga components, spacing, typography, dark/light theme support, localized text, stable interaction IDs and keyboard conventions.

Normal ticket entry opens Requester. A notification or URL containing a valid conversation/message opens that destination instead. Conversation changes preserve per-author drafts and use navigable URL state; browser back/forward returns to the prior selection. A denied deep link provides an opaque access result and a route back to permitted ticket content without revealing private names.

Adapt C to narrow layouts with a clearly labeled collapsible/list selector above the conversation. Preserve grid/entry preference and embedded ticket drawers: provide the same audience/navigation/composer behavior within their available space without forcing the grid layout. Respect existing chronological-order preferences and accessible focus management.

### 5.2 Creation and composition

Creation asks for a name, email or internal conversation, organizational audience and, for email, explicit recipients and an available authorized mailbox. Internal AI assistance can be created/invoked without enabling email. Organization-private is the default for vendor/internal work; Shared IT is an explicit choice where permitted. Creating an empty conversation sends nothing.

External human composition uses **Send** with a clear email review; internal work uses **Post**. AI uses **Ask AI**. Review shows the exact From, To/CC, body and selected attachments. It omits protected source links and internal metadata. If a displayed audience, recipient/envelope revision or mailbox authority changes before send, preserve the draft and require a refreshed review rather than silently redirecting it.

Drafts are privately saved per qualified author and conversation, survive switching/reloading, and do not notify anyone. Saving editable text is distinct from reserving an immutable publication operation. Switching authors never reveals another author's draft. Existing destination drafts are not silently replaced by a share or synthesis; offer to return to that draft or explicitly replace it. Failed operations preserve recoverable draft content and show actionable retry state. Uncertain sends reuse the same operation identity and cannot send a second copy through a naive retry.

### 5.3 All activity and historical editing

All activity is a chronological authorized view with conversation labels, normal message attribution, resolution markers and existing reply relationships. Reply opens the original conversation's composer; All activity is not a broadcast composer. Keep resolution as a marker/filter, not a new conversation audience. Preserve existing authorized edits, deletions, reactions and attachment behavior; editing a source never edits an already shared copy or pretends to recall delivered email.

## 6. Email, recipients and notification behavior

### 6.1 Sender and recipient identity

Requester mail uses the ticket-owning workspace's configured mailbox. Vendor mail uses the creating organization's authorized mailbox. Persist that identity independently of current responsibility, assignee or Shared IT visibility. A foreign technician needs an explicit existing or narrowly scoped mailbox delegation to send; read/post authority is not send authority. Only expose an intentional mailbox change when authorized, with its effect visible before send. A disabled/revoked mailbox leaves a recoverable draft and sends nothing.

Resolve reply-all from the latest accepted inbound sender and To/CC, excluding the platform's own routing addresses and duplicate addresses. Highlight newly introduced correspondents so the next human sender can edit them in the normal review. Do not require a separate invitation/approval ceremony for each valid correlated addition. Editing the draft recipient set must not rewrite historical envelopes. Vendor recipients do not become portal users, ticket watchers, authorized IT staff, or readers of historical messages.

Only explicitly sent text/quotes and selected attachments leave the conversation. Do not append the ticket's prior customer/internal history or a vendor conversation's complete history by default. Preserve existing standard signature/email framing without pulling unauthorized content into it.

### 6.2 Inbound correlation and ambiguity

Extend the existing email reply admission and token/header mechanisms to identify the qualified ticket, conversation, originating organization and mailbox. Provider message IDs, Message-ID, In-Reply-To/References and existing reply artifacts must resolve consistently within the provider/mailbox scope. Validate conflicting evidence and token/admission rules before writing content. A subject ticket number alone is not authority to place a side reply into Requester.

A validly correlated vendor reply, including one from a newly introduced colleague, lands in that vendor conversation with its files and organization boundary intact. Email correspondence admission is not a login grant. Ambiguous, conflicting or untrusted replies use the existing unresolved/quarantine path (extend it if needed) for authorized review; never guess into the requester conversation. Authorized resolution selects the intended destination explicitly and reuses duplicate protection.

Deduplicate provider retries and attachment imports; one accepted delivery yields one published message and one set of notification effects. Preserve original/sanitized content and accepted envelope metadata through existing email infrastructure. Local and co-managed inbound paths both need named-conversation awareness; legacy requester routes remain compatible.

### 6.3 Event and recipient matrix

| Event | External email | Internal notification / attention | Ticket response/SLA |
| --- | --- | --- | --- |
| Draft save/share/synthesis generation | None. | None to followers/assignee; author sees local completion/error. | No effect. |
| Explicit human requester Send / requester portal reply | Existing intended requester delivery behavior; no side recipients. | Existing authorized ticket notifications with exact conversation link. | Preserve existing qualifying requester/technician behavior. |
| Human vendor Send | Explicit reviewed vendor To/CC only. | Current authorized followers/assignee according to normal preferences; avoid duplicate self-alerts. | Not a requester reply or customer-visible response; do not satisfy requester response SLA. |
| Accepted vendor inbound reply | No echo/broadcast to requester or automatic full-history send. | Mark this conversation unread/needing attention; notify current authorized followers and assignee only. | Parent unchanged by default; optional board policy below. |
| Human internal/Shared IT Post | None to external recipients. | Authorized followers/assignee, respecting organization and existing preferences. | Does not satisfy requester response obligations. |
| Explicit AI invocation/output in internal conversation | None. | Visible to that conversational audience; do not fan out every AI token/answer as follower email. The invoking user sees completion/failure. | No business-state effect. |
| Human shares AI/internal content and explicitly Send/Post | Destination rules apply once. | Destination rules only. | Evaluate the final human destination action, not the private source. |

Following controls internal notifications, never access or transport recipients. The author can follow/unfollow; the currently assigned technician receives attention only where currently authorized. Reassignment and revocation are resolved at delivery time. Do not expose private conversation existence by updating a customer-visible activity badge/timestamp or emitting an unfiltered generic event.

## 7. Conversation state and existing reopen policy

Conversations have **Open** and **Done**, independent of ticket status. Marking Done does not resolve the ticket. An accepted substantive external reply reopens that conversation, marks it unread and restores attention. Resolving a ticket can warn about open external conversations but must not block resolution or mark every conversation done.

Existing board settings are the authority: `inbound_reply_reopen_enabled` (default false), `inbound_reply_reopen_cutoff_hours` (normalized default 168), `inbound_reply_reopen_status_id`, and `inbound_reply_ai_ack_suppression_enabled`. Preserve current requester and internal-technician email handling, explicit valid open status then board-default fallback, cutoff precedence, acknowledgment classification, automated reply/bounce protections and rate limiting. Do not reinterpret these as requester-only rules if the current implementation permits internal technician replies.

Add one board option: **Apply this policy to side-conversation email replies**, default **off**. It does not enable the parent policy itself. When both switches are on, qualified side replies reuse the existing policy, including the cutoff's follow-up-ticket behavior; do not introduce separate cutoff/status/suppression settings.

| Side reply condition | Conversation / parent result |
| --- | --- |
| Parent open, or side option off, or master reopen setting off | Accepted substantive reply updates its conversation/attention; no automatic parent transition. |
| Parent closed, both options on, inside cutoff, policy allows reopen | Update conversation and reopen parent using the existing target/status behavior and canonical lifecycle effects. |
| Parent closed, both options on, cutoff exceeded | Preserve existing follow-up-ticket policy; route into an equivalent side conversation on the follow-up, retaining audience, qualified ownership and envelope. Do not copy private history into its requester conversation. |
| Policy suppresses a reopen | Preserve the policy decision without classifying side/AI traffic as a requester response or triggering a bundle reopen indirectly. |

Reuse existing noise classification for conversation attention; automated acknowledgments must not create a fresh notification/reopen loop. Do not change legacy cutoff-before-suppression precedence as part of this card. Side-reply follow-ups must obey existing access/creation policy; unresolved authorization uses protected review, not a public fallback.

Ticket bundles, workflows and both organizations' SLA clocks must receive the accurate conversation/audience/author event classification. A real policy-authorized parent reopen follows the existing canonical reopen lifecycle; ordinary side activity cannot start, satisfy or reset unrelated requester/MSP obligations or trigger `reopen_on_child_reply` through misclassification.

## 8. Selective sharing and whole-conversation synthesis

### 8.1 Selective sharing

A permitted technician can choose a published message, select an existing or new destination on the same ticket, and prepare an editable copy. Requester is the default destination. The default is plain editable text under the sending technician's identity; quoting is optional. Start attachments unchecked and disclose precisely the selected files. Sharing never changes membership, audience, follow state or historical envelopes.

Keep internal source lineage qualified to the source store/conversation/message/revision. Destination readers may see a source link/name only if they can independently read the source. External email and requester portal must exclude protected source metadata; the deliberately selected content can be shared after human review. The copy is a snapshot: later source edits/deletion or permission changes do not propagate changes into an already published destination copy. Apply destination retention/deletion rules independently.

### 8.2 Whole-conversation synthesis

Synthesis is a separate action from selected-message sharing. Its source is the complete authorized published source conversation, including human/AI messages in their reply order; omit unpublished drafts, deleted/redacted content and out-of-scope attachments. Select destination and audience before generation. For a new destination, require a name and explicit external recipients where applicable; generating or creating that destination sends nothing.

A technician may explicitly use a private source to prepare a requester-facing summary if allowed to read the source and write the destination. This is a private transformation draft, not shared AI inference visible to the destination audience. Keep source text, prompt, private generation metadata and provenance within the author's authorized private context until reviewed output is deliberately published. This exception must not widen the context of ordinary Shared IT AI conversations.

Generate audience-appropriate text and preserve a source revision/cursor. Show the result in the destination's author-private composer for editing, email preview and explicit Send/Post. New source messages show **New source messages available**. Regeneration is optional and explicitly replaces current draft edits; never regenerate silently or clear edits on failure. If the source exceeds model context, process the full permitted source through bounded synthesis or report that complete synthesis is unavailable; never claim completeness after silently truncating it.

AI generation failure, cancellation or unavailable entitlement leaves the source untouched and creates no published message or email. Existing/new destinations remain usable for manual composition. Concurrent completion uses draft revision checks so a stale response cannot overwrite newer editing or disclose output after access loss.

## 9. AI participation and context

Reuse Alga's existing AI services, provider configuration and entitlement behavior. AI is optional and explicitly invoked for recap, next steps or a response draft. Persist authorized human prompts and attributed AI replies as internal ticket conversation history. AI cannot independently send external email or mutate ticket status/recipients. Mixed human/AI internal discussions are supported without turning every AI response into outbound mail.

Before inference, calculate the intersection of the actor's current readable ticket context and the output conversation's audience. Organization-private AI can use requester/shared context plus permitted context in its own organization; it cannot read the other organization's private notes. Shared IT AI can use only material allowed for both organizations. A user's greater personal visibility never expands Shared IT's context. Present the actual source conversation list and allow narrowing it. Filter content, filenames, snippets, citations and linked resource reads before building the prompt; do not rely on the model to redact forbidden information afterward.

Treat source messages as data, not instructions granting tools, recipients or broader access. The AI invocation's tools, if used for existing retrieval, inherit the same qualified resource/context boundary. Generated citations are resolved only for currently authorized readers. Recheck audience/source grants before making completed output visible; cancel/discard stale output if those grants change. AI capability unavailable/disabled leaves all non-AI conversations, sharing and manual replies working.

## 10. Data, API and integration design

The following are logical contracts. Confirm physical names against the parent schema before migration; avoid parallel duplicate content stores or unconditional dependencies from CE ticketing onto EE services.

| Record / contract | Required information and invariants |
| --- | --- |
| Named conversation | Qualified ticket reference; stable conversation identity; name; default-requester marker; audience; content-owning organization/store; transport; originating mailbox owner/reference; Open/Done; revision. Private metadata resides in its private store. Exactly one default per ticket. |
| Message association | Existing qualified comment/private-comment reference plus named conversation identity; preserve existing thread/root/parent, qualified author, content revision and attachment inheritance. AI authors need explicit type, not a fake human login. |
| External correspondence | Provider/mailbox-qualified inbound identity and accepted headers; immutable sent envelope and correlation tokens; editable pending recipient defaults are separate. |
| Draft | Qualified author, destination, editable text/files, revision, optional protected source/generation references; private autosave model separate from immutable publication reservations. |
| Share/generation provenance | Source store/conversation/message versions or full-conversation cursor, destination, invocation author, private prompt/output staging, attachment selections and published-copy linkage. No protected titles/body in customer-readable metadata. |
| Per-viewer state | Qualified actor/conversation read cursor and follow preference, filtered on current resource/audience access. |
| Side-policy setting | Board boolean default false; shares the existing board reopen policy and validation. |

Expose cohesive domain operations for list/read conversations, create/change authorized metadata, read/publish messages, save/load/discard draft, follow/read cursor, email envelope preview/send, selective-share draft preparation, full-conversation synthesis, and correlation/admission. Implement adapters for existing server actions/API/portal/email/event surfaces. Do not accept arbitrary store/tenant references as permission to query them.

Mutations use current audience and draft/envelope revisions, stable operation identity, qualified keys and existing transactional/outbox infrastructure. Publish a message and its prepared attachments atomically, then fan out permitted events/delivery. Unknown transport outcomes preserve the same idempotency receipt; conflicting reuse of an operation ID is rejected. Queued jobs carry qualified scope and reauthorize before external delivery. Ordinary local tickets stay on native auth; co-managed wrappers must not impose co-managed licensing on CE/native use.

### Existing integration anchors

- Ticket shell/rendering: `packages/tickets/src/components/ticket/TicketDetails.tsx`, `TicketConversation.tsx`, and `bento/TicketBentoLayout`.
- Native mutations/response state: `packages/tickets/src/actions/comment-actions/commentActions.ts`, `optimizedTicketActions.ts`, `ticketBundleUtils.ts`, and shared ticket response-state helpers.
- Qualified readers/storage/policy: `packages/co-managed/src/ticketConversation.ts`, `privateTicketConversation.ts`, `sharedWork.ts`, `sharedWorkIdentity.ts`, `conversationPolicy.ts`.
- Publication/files/disclosure: `packages/co-managed/src/conversationDrafts.ts`, `conversationAttachments.ts`, `threadDisclosure.ts`, `privateThreadDisclosure.ts` and associated admission/cleanup modules.
- Email: `shared/services/email/processInboundEmailInApp.ts`, qualified/requester reply admission, and `packages/co-managed/src/inboundEmailReply.ts`, `inboundRequesterReply.ts`, reply tokens, email deliveries, recipient and event-consumer modules.
- Board settings: `packages/tickets/src/components/settings/BoardsSettings.tsx` and `actions/board-actions/boardActions.ts`.
- AI: existing EE chat actions/completion/stream services, accessed through current edition boundaries.

## 11. Compatibility, migration and release

Backfill or lazily initialize named containers idempotently: requester/public history into default Requester, existing internal history into its existing organization-private audience, and co-managed Shared IT history into Shared IT. Preserve every root/parent relationship, author, resolution marker, attachment link and scheduled/publication status. Multiple roots belong to a grouped named conversation; never expose each historical root as a new sidebar item. Mixed or inconsistent audience metadata must use existing strict resolution/guard behavior, not be normalized to a broader audience.

New ticket creation, inbound ticket creation and legacy writes that lack an explicit conversation must resolve deterministically to the correct default audience container. Existing co-managed reply artifacts retain their ticket, source root and audience mapping. Migrations and lazy initialization must be safe under concurrent access and retries and preserve retained data on rollback. Update tenant-owned table declarations, distribution/qualified key rules, export/archive/deletion selectors and attachment cleanup wherever new persistence is introduced.

The release boundary is explicitly **UI only**: wrap new conversation controls/navigation, relevant portal affordances and new board setting UI in `release-v1-6-feature`. Do not gate routes, API handlers, authorization, migrations or backend delivery with this flag. When hidden, existing UI continues to read/write its appropriate legacy audience and must not flatten newly created vendor/private/AI messages into the old customer stream. AI availability and co-managed eligibility remain their existing independent capability checks.

### Delivery sequence

1. Named model, native/co-managed adapters and history mapping, with real migrated-DB isolation tests.
2. Option C navigation/composers, private drafts and non-AI local/portal flows.
3. Vendor envelopes, inbound correlation, subscriptions, Open/Done and board-policy integration.
4. Selective sharing, attachment copies and protected provenance.
5. Optional internal AI and whole-conversation synthesis, with audience-filtered input and reviewed publication.
6. Representative end-to-end email/UI validation, legacy compatibility and ownership/export checks.

These are implementation checkpoints within this card. Vendor email, sharing and synthesis are all in scope; the sequence does not defer the latter capabilities. Individually restricted conversations remain the separate follow-up.

## 12. Risks and implementation decisions

- **Parent progress:** inherited co-managed code is substantial but still evolving. Verify actual exported APIs, migrations and incomplete parent checklist items before implementing adapters. Restack changes deliberately and test shared contracts.
- **Private storage:** private conversation metadata, lineage, drafts, files and events must not leak merely because message bodies are filtered. Disclosure is an authorized transfer, not just changing a label.
- **Email ambiguity:** bind to accepted provider/mailbox evidence and existing token/admission rules. Do not invent a subject-only side-conversation fallback. Determine the exact existing protected review surface before extending it.
- **Draft mechanisms:** the current parent's immutable attachment publication protocol is not autosave. Decide the minimal reusable draft abstraction that supports text-only and rich/file composition with revision protection.
- **Sender delegation:** inspect existing mailbox grants; if no adequate grant exists, add a narrowly scoped authorized-send capability sufficient for this flow. Do not equate Shared IT with send authority.
- **Board policy and events:** legacy reopen, auto-suppression, follow-up creation, bundles and two SLA obligations interact. Preserve policy ordering and classify side traffic explicitly.
- **Portal/layout breadth:** option C is the technician design. Add only necessary requester conversation navigation to existing portal layouts; do not copy the prototype's technician shell into the portal.
- **Full-source AI:** generation must transparently handle context limits, failures and stale drafts without sending or silently discarding edits.

No additional product interview is required to draft implementation. These are bounded technical discovery points to record in the scratchpad. Any scope change, such as individual restrictions, autonomous AI sending, or a new licensing requirement, needs a new product decision.

## 13. Acceptance criteria and validation

1. A native requester-only ticket retains its normal reply experience; a co-managed ticket uses one authoritative customer-owned resource and correct qualified actors.
2. Option C defaults to Requester, clearly switches audiences and unread conversations, preserves drafts and opens exact permitted notification destinations.
3. Two simultaneous vendor exchanges and the requester exchange keep outbound envelopes, inbound replies, files and attention independent, including a new valid vendor correspondent and duplicate delivery.
4. Requester, both IT organizations, revoked users and foreign scopes see exactly their permitted conversations, metadata, files, citations, drafts and notifications. Shared visibility never implies mailbox authority.
5. Internal/AI events send no external email; all outward sharing/synthesis requires a reviewed human Send/Post. Source membership never expands and protected lineage never leaves its boundary.
6. AI prompt construction excludes unauthorized material before inference. Whole-source synthesis supports existing/new destinations, private staging, explicit files, source-change notice and opt-in regeneration without overwriting edits on stale completion.
7. Default vendor reply behavior affects its conversation only. Opt-in board behavior preserves cutoff, status and suppression semantics and side audience on follow-up creation; legacy requester/technician replies and bundle/SLA behavior remain correct.
8. Migration/replay and legacy writes retain audiences, reply relationships, authors and files without producing a sidebar row per legacy root. Flag-off UI never leaks new side content into the legacy stream.
9. New persistence is exercised against a real migrated database with a happy path and tenant/audience failure cases. Representative integration tests cover transactional retries, concurrent creation/publication, revocation and ownership/export selection. Source-string assertions cannot substitute for query execution.
10. Browser checks exercise option C through actual application components on native/co-managed/portal paths. Email integration uses the available test email infrastructure; mock only provider/AI boundaries when necessary and disclose them. Prototype screenshots alone do not establish product completion.

`features.json` defines atomic implementation work. `tests.json` deliberately groups representative journeys and high-impact guards rather than mirroring every feature with a shallow test. All entries begin unimplemented and are updated only with actual implementation evidence.
