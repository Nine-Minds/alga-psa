# Scratchpad — shared contract charge resolution

- Spec situation: no design-session plan for this card on the branch (`git log main..HEAD -- docs/plans/` lists only upstream plans; nothing 2026-10 about charge resolution/simulator/pools). Built from card brief + dossier.
- Ticket alga-2026-0002684 "Internal analysis (2 of 2)" was readable via the Alga API (ticket comments endpoint); root cause matches the card: simulator only prices `Bucket`-typed services; engine reads contract_line_buckets/bucket_usage; resolveBucketForLine drops pooled hours from the hourly query.
- Engine `client_contract_line_id` === `contract_lines.contract_line_id` everywhere (aliased in SQL). Pool identity mismatch is naming only.
- Engine does not exclude usage under pools; only hourly (resolveBucketForLine). Preserved.
- Test DB: `docker` container alga-currency-test-pg on 5472. Run EE integration tests with
  `cd ee/server && TEST_DB_NAME=alga2684_test DB_HOST=127.0.0.1 DB_PORT=5472 npx vitest run --config vitest.integration.config.ts <file>`
- Parity suite: `ee/server/src/__tests__/integration/contractChargeResolutionParity.integration.test.ts`.

## Pool identity fix — evidence
`loadBucketObligation` now queries `contract_line_buckets` by `contractLine.contract_line_id` (was the
`client_contract_line_id` alias, populated from the same column). Full invoice-line dump
(`CHARGE_RESOLUTION_DUMP`) of the parity fixtures before vs after this commit: byte-identical. Conclusion:
the mismatch was naming-only; it changes no live pool charge.
