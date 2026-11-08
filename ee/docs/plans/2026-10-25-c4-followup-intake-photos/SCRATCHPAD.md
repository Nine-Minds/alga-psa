# Implementation notes

- [Customer ticket alga-2026-0002683](https://algapsa.com/msp/tickets/eb4a5b58-4bb1-48be-961f-8c2aeebcc0ed).
- Approved design: [PLAN.md](PLAN.md). Branch stacks on follow-up 1/3 at `a5856113f9`.
- `asset_custody_events.document_ids` is the event-photo link. No new event-photo table or column.
- Receive inserts asset document associations in the same transaction as the received event. Ticket associations remain.
- `withPrivateDocumentUploads` composes document rows, associations and the domain write. Storage's `withFileUploadTransaction` records paths before provider writes and atomically claims retained originals/previews when the document transaction commits.
- A live session holds a row lock. Recovery skips locked sessions, retries failed provider deletes every five minutes, and recovers interrupted sessions after one hour. Both CE and EE schedule `recover-file-uploads`. Recovery is tenant-scoped and deletion is idempotent.
- `getAssetDocuments` enforces asset and document reads; shared custody services validate submitted document IDs and filter returned IDs for both actions and REST. Client visibility is checked before returning metadata.
- The repository has no standalone thumbnail component. Custody history reuses the authenticated `getDocumentThumbnailUrl` pipeline and opens the existing document viewer. Denied reads and failed image loads render nothing. DOM IDs include the event so a reused document produces no duplicate control IDs.
- Move, hand off, ship, receive back and return use one shared photo picker and upload path. The document engine is injected through the existing asset composition context to preserve package boundaries.
- Picker and server allow 20 photos and 10 MiB total, leaving headroom under the default 20 MB server-action limit. A deployment configured below that limit must use a compatible request limit.
- Private uploads do not inherit a folder's client visibility. Actual client document lists, asset Documents and history are covered by the database tests; a public control document remains visible.
- Documents' missing tsup configuration was added using the same source-file build preset as assets. Storage, documents and assets builds pass.
- Behavioral validation covers real database rows and real image preview generation with a fake storage provider: successful receive, partial provider write failure, failed receive, cleanup outage/retry, abandoned/live sessions, unretained previews, later custody steps, backfill, permissions and client visibility. Component tests cover step submission, limits, matching history entries and viewer refusal.
- No app server or browser was started. Live browser confirmation remains a human review step.
- Preserve the pre-existing `package-lock.json` modification; no push or PR is authorized.

## Verification

- Combined focused run: 100 tests across 11 suites, including 30 database integration tests.
- Full server TypeScript check passes with `NODE_OPTIONS=--max-old-space-size=16384 npx tsc --noEmit --incremental --pretty false` from `server/`; it includes the changed composition modules and tenant table metadata.
- Assets, documents and storage builds and their package typechecks pass.
- Plan validation, translation validation and migration lint pass.
- Review the storage claim/recovery transaction first, then the two-photo receive and later-step paths. Live smoke testing must apply the new migrations before starting the app. No live browser claim is made.

## Deploy mitigation verification (2026-10-28)

The smoke at `46b49a5003` found reversed thumbnail and preview URLs, an original-view document
permission bypass, and an asset-read bypass. The shared document boundary now checks document
RBAC and each associated asset's RBAC and record decision. The asset decision helper moved to
the authorization package and remains re-exported by assets. Public tenant logos remain public
unless associated with an asset or comment attachment.

- Isolated database and handler test: 7 passed. It uses real roles and a published asset-narrowing
  bundle, injected sessions, local storage and actual handlers. It checks helper URLs, original
  file and document IDs, public logo access, private metadata, and thumbnail, preview, original
  and download refusals. API-key authentication and browser rendering were not exercised.
- Custody integration and history: 32 passed, including failed receive cleanup, associations,
  client hiding and later custody steps. These existing fixtures mock permission checks.
- Document content and permission integration: 16 passed. Content tests mock permission grants
  to focus on document record and redaction rules.
- Dialog, preview and existing viewer authorization tests: 16 passed.
- Authorization, shared, documents, assets and storage package builds passed. The full server
  TypeScript check passed with a 16 GiB Node heap.
- No application server was started. Live review remains outstanding: receive two PNGs, inspect
  asset Documents and the matching received and moved history entries, then repeat direct photo
  requests under roles missing document or asset read.
