# Task thread audience changes (T09)

The internal task conversation now offers the existing audience confirmation dialog to the root author. It previews the full current thread, reply/tombstone state and posted attachments. A changed snapshot or pending file requires a new review. Customer-local and MSP actors retain their own session and current native/project collaboration authority throughout the operation.

Canonical task threads keep their comment, thread and attachment identities. Audience changes increment every task comment revision so an older content edit cannot silently cross an audience change. A reduction to customer-private retains authorized MSP participation and file evidence before changing the live audience. MSP actors cannot relabel a customer-owned thread as MSP-private.

MSP-private disclosure uses the existing staged transfer protocol. Its source-owned journal now qualifies exactly one ticket or task parent. The transfer preserves historical actor references, reply structure, creation timestamps and empty tombstones; it verifies original file lengths and digests, then copies posted files into customer ownership. Customer comment/file rows appear only in the final publication transaction. Exact retries use the same mapping, paths and receipt. Current scope/session/lifecycle checks apply during transport and before publication. Published source threads stop accepting private writes and remain retained as history.

Task disclosure files use a separate `task-disclosures` path segment. Downloads and archive staging validate that path from the actual attachment parent. Abandoned-transfer cleanup computes only the journal's task paths; it cannot remove published files or substitute ticket disclosure paths. Existing ticket paths and ticket-only entry points remain compatible.

The server adapter records a metadata-only qualified task audit and one `PROJECT_TASK_COMMENT_UPDATED` invalidation per canonical comment, including tombstones. These events carry task/thread/audience/revision identity, never comment bodies. They do not send old comments as newly created requester mail.

Migration: `20260908232516_add_co_managed_task_thread_disclosure.cjs`, generated with Knex. It adds the task parent to the transfer journal, permits disclosed posted task attachments, and retains journal parent identity with a trigger.

Focused validation: seven task PostgreSQL journeys cover canonical identity/revision preservation, root-author and snapshot/pending-file denial, real private production adapter/file download, tombstones, exact replay, failed transport/resume/cleanup, integrity/path forgery, prior archive retention and session expiry after transport. Five existing ticket disclosure PostgreSQL regressions passed. Fifty-one focused task/ticket UI and shared-action tests passed. No full build or broad TypeScript/test sweep was run.
