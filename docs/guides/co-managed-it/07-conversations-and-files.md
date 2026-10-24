# Conversations and files

Messages have one of three audiences: **Requester and IT teams**, **Shared IT teams**, or **My organization only**. Files inherit the message's audience; changing a thread audience also affects its replies and attachments.

## Before you start

Use QA and Alice on [shared ticket 000002](http://feature-co-managed-it.localhost:23374/msp/co-management/tickets/1f98df77-cd15-44c2-8f4d-42ff52d01e84/c7de2b20-f1d9-4374-b7bb-c223f681955e/cfff4242-7962-4100-a54c-687eaa540500), or a disposable shared ticket. Prepare two small text files with distinctive contents. Portal/task checks also require an authorized requester and a prepared shared task from [Projects and tasks](06-projects-and-tasks.md).

The previous ticket run demonstrated a shared message and private-note separation. It did not freshly demonstrate every file, disclosure, requester or email flow here. See [review conventions](README.md#review-order-and-retained-changes).

## Risks to check

- A private message or file becoming visible to another organization or requester.
- A retry publishing duplicate messages or incomplete attachments.
- A thread audience change leaving replies or files at the old audience.
- Deletion destroying reply context or misattributing the author.

## 1. Check all three audiences

1. As QA, choose **Shared IT teams** in the native conversation audience control. Send `CM-REVIEW-20261018-A shared` using the normal send control.
2. Reload as QA, then open the [customer ticket](http://feature-co-managed-it.localhost:23374/msp/tickets/cfff4242-7962-4100-a54c-687eaa540500) as Alice and reload.
3. Post separate **My organization only** messages from each organization, then compare both views.
4. On a requester-enabled fixture, post **Requester and IT teams** and compare the authorized requester's normal portal conversation.

Expected: shared IT messages appear to both IT teams with organization-qualified authors. Each organization-private message stays local. The requester sees only requester-audience content. Grid and Entry enforce the same rules.

## 2. Publish and remove audience-bound files

Use **Attach files** in the composer, choose a prepared text file and send the message. Observe upload/publication progress. Reload and download the file as each permitted identity; compare its contents. Copy the download link and try it as an identity outside the audience.

Expected: the published message contains a complete downloadable file for authorized readers only. Unsupported audience, size or count must be reported before successful publication. Recover an uncertain upload/send with the offered retry rather than posting another copy.

If attachment **Remove** is offered to the author, remove a disposable file and confirm the old link no longer downloads after reload. Preserve other evidence files.

## 3. Keep replies and authors after edits or deletion

Reply to a disposable shared message from the other organization. Edit an eligible message, reload both views, and compare text and author attribution. Delete only the disposable root message, then reload.

Expected: the deleted root becomes a tombstone; its surviving replies and their attribution remain. Another author's message must not become editable just because the viewer can collaborate on the ticket.

## 4. Review a whole-thread audience change

For a disposable thread you are allowed to disclose, open **Change thread audience** from its available message action. Read the preview's message/attachment counts, choose an offered audience and **Confirm audience change**.

Reload as every affected identity and retest file links. Expected: replies and attachments follow the new audience. Sharing an MSP-private thread transfers the disclosed thread and files to the customer workspace; the MSP-private original remains read-only history. Restricting access cannot recall previously read or downloaded content.

## 5. Review requester task conversations and mail separately

On a prepared requester-visible project task, open the requester's **Conversation** control in the normal portal. Compare requester messages, attachments and author organization with the staff task view. Use [Customer-owned integrations](12-customer-integrations.md) for delivered mail and inbound reply proof.

Shared MSP native ticket composers deliberately disable scheduled send. Do not look for a scheduling control here merely because scheduled-comment backend code exists.

## Pass criteria and retained state

Pass when text, replies and file access follow the same audience across both organizations and the requester, with no duplicate publication after recovery. Preserve review messages and downloads as evidence. Audience disclosure cannot be undone as a promise of secrecy; use disposable content.

## Source references

- [Shared native conversation adapter](../../../server/src/components/co-managed/sharedTicketDataSource.tsx)
- [Thread disclosure dialog](../../../server/src/components/co-managed/CoManagedThreadDisclosure.tsx)
- [Requester task conversation](../../../server/src/components/co-managed/CoManagedRequesterTaskConversation.tsx)
- [Draft and attachment publication](../../../packages/co-managed/src/conversationDrafts.ts)
