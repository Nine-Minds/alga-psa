# Scratchpad

- [Customer ticket](https://algapsa.com/msp/tickets/eb4a5b58-4bb1-48be-961f-8c2aeebcc0ed).
- Approved implementation design: [PLAN.md](PLAN.md). The checkout initially lacked C4; the plan commit was rebased onto follow-up 1/3 at a5856113f9. Preserve the unrelated package-lock.json modification.
- `openCustody` and `recordCustodyEvent` serialize document IDs; `service.ts` reads them. The history adapter omits them.
- Receive uploads client-hidden ticket documents before the transaction; `receiveEquipmentForTicket` passes IDs to `openCustody` but creates no asset document associations. The asset Documents tab calls `getAssetDocuments`, which joins asset document associations.
- Receive uploads run within one server action invocation; only the IDs returned by that invocation are eligible for cleanup. Submitted pre-existing IDs are rejected. Cleanup failures are surfaced. The combined request is bounded by the server-action limit (20 MB by default), which needs further UX/design work.
- `getAssetDocuments` now checks asset record access, document read permission and document authorization/redaction. The custody action filters document IDs as well; the REST service path still requires an equivalent review. Thumbnail URLs perform document authorization.
- No server was started. Live browser confirmation remains required.

- The real-DB custody suite passed 21 tests including new/existing receive, forced rollback, and two backfill runs. Asset build and typecheck and documents typecheck passed; server typecheck exhausted its default Node heap. History thumbnails/viewer and shared step photo inputs are not implemented, and cleanup/authorization behavioral coverage is incomplete.
