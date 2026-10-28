# Scratchpad

- [Customer ticket](https://algapsa.com/msp/tickets/eb4a5b58-4bb1-48be-961f-8c2aeebcc0ed).
- Approved implementation design: [PLAN.md](PLAN.md). The checkout initially lacked C4; the plan commit was rebased onto follow-up 1/3 at a5856113f9. Preserve the unrelated package-lock.json modification.
- `openCustody` and `recordCustodyEvent` serialize document IDs; `service.ts` reads them. The history adapter exposes them and the custody card renders authorized photos.
- Receive uploads client-hidden ticket documents before the transaction; `receiveEquipmentForTicket` passes IDs to `openCustody` and creates asset document associations transactionally. The asset Documents tab calls `getAssetDocuments`, which joins asset document associations.
- Receive uploads run within one server action invocation; only the IDs returned by that invocation are eligible for cleanup. Submitted pre-existing IDs are rejected. Cleanup failures are surfaced. The picker and server reject more than 20 photos or more than 10 MiB combined, leaving headroom under the default 20 MB server-action limit; deployments with a lower configured limit need additional handling. Cleanup is not durable on storage deletion failure.
- `getAssetDocuments` now checks asset record access, document read permission and document authorization/redaction. The shared custody service filters document IDs for both server actions and REST, and validates IDs on writes. Thumbnail URLs perform document authorization.
- No server was started. Live browser confirmation remains required.

- The real-DB custody suite passed 21 tests including new/existing receive, forced rollback, and two backfill runs. Asset build and typecheck and documents typecheck passed; server typecheck exhausted its default Node heap. History thumbnails/viewer and shared step photo inputs are not implemented, and cleanup/authorization behavioral coverage is incomplete.

- Custody card renders authorized event images through the existing document viewer; the shared picker is used by receive only. Move, hand off, ship, and return inputs and durable cleanup recovery remain unfinished. The comment-attachment retry machinery is comment-specific and cannot safely own custody uploads unchanged.

- This round: the custody integration suite passed 22 tests; backfill now verifies missing and cross-tenant IDs and repeats safely. The photo-viewer component passed three tests, photo limit/history tests passed 11, and the API controller suite passed seven. A scoped msp-composition TypeScript check passed after correcting an action error. Assets build/typecheck passed. The complete server typecheck exhausted 8 GiB and passed with 16 GiB after fixing the receive action type error. Documents build fails because its tsup script has no input or configuration; documents typecheck passes.
