# Scratchpad

- [Customer ticket](https://algapsa.com/msp/tickets/eb4a5b58-4bb1-48be-961f-8c2aeebcc0ed).
- Approved implementation design: [PLAN.md](PLAN.md). The checkout initially lacked C4; the plan commit was rebased onto follow-up 1/3 at a5856113f9. Preserve the unrelated package-lock.json modification.
- `openCustody` and `recordCustodyEvent` serialize document IDs; `service.ts` reads them. The history adapter omits them.
- Receive uploads client-hidden ticket documents before the transaction; `receiveEquipmentForTicket` passes IDs to `openCustody` but creates no asset document associations. The asset Documents tab calls `getAssetDocuments`, which joins asset document associations.
- The existing receive failure cleanup deletes submitted IDs without proof they are uploads belonging to this attempt; a failure during the upload loop leaves earlier uploads. Fixing this safely requires a server-owned attempt identity and ownership validation. Do not simply trust IDs or delete documents based only on creator/ticket.
- `getAssetDocuments` checks the asset read permission but does not enforce record-level asset access or document read/redaction; adding asset associations without fixing that boundary can disclose metadata. Thumbnail URLs perform document authorization.
- No server was started. Live browser confirmation remains required.
