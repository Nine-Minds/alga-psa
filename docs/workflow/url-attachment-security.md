# Workflow URL attachment security

The workflow `Add Ticket Attachment` action uses the shared `safeFetch` boundary for URL sources. It retains HTTPS-only requests, public-address validation, DNS connection pinning, manually followed redirects, strict timeouts, streamed byte limits, and IPv6 reserved-range protections.

URL sources must also match the effective download-host policy for the workflow transaction's tenant. The policy comes from `document_fetch_hosts` plus the built-in hosts in `shared/lib/net/fetchHosts.ts` (re-exported by the server document service). Effective entries are enabled built-ins plus tenant custom entries, minus disabled built-ins. Exact and leading `*.` patterns use the shared hostname normalization and matching rules.

The worker loads this policy with the current `tx.tenantId` before calling `safeFetch`. The shared fetch boundary checks the initial hostname before DNS and checks every redirect destination before contacting it. A permitted first host does not permit a redirect to another host unless that destination is also allowed. Empty tenant rows retain the built-in hosts. Malformed patterns do not match; policy lookup errors fail the action before any outbound request. These failures cannot create storage objects, external-file records, document records, or ticket associations.

Tenant administrators manage entries at **Settings → MCP Server → Allowed download hosts**. Add the exact public HTTPS hostname used by the workflow, or a narrowly scoped wildcard when needed. Shared hosting suffixes are refused by the settings validator; do not use broad shared-storage patterns.

Behavioral coverage lives in `shared/workflow/runtime/actions/__tests__/businessOperations.attachDocumentToTicket.native.test.ts` and `server/src/lib/net/__tests__/safeFetch.test.ts`. The first covers tenant selection, disabled built-ins, initial and redirect allowlist rejection, successful ingestion, redirect chains, malformed/empty policy, and no persistence on rejection. Prohibited hosts are checked before DNS at each of the three supported redirect positions. Allowlisted hosts that resolve to private addresses remain blocked. The shared guard suite covers network and redirect protections for all callers.

## Human review

These steps come from the implemented settings and workflow screens. They have not been rerun in a live browser for this repair. The earlier November 2 recording at `fe7e9d8174a6643a08d39eb642b96f4760e5d052` predates tenant-host enforcement.

Use an isolated review tenant, an accessible test ticket and a workflow containing **Add Ticket Attachment**. Run the app and worker from the PR branch. Record the ticket's existing attachments before each run. The risks are unauthorized downloads, redirects escaping tenant policy, cross-tenant policy leakage, and rejection of legitimate existing files.

1. **Allow a useful attachment.** In **Settings → MCP Server → Allowed download hosts**, click **Add host**. Enter `httpbingo.org` in **Host** and submit **Add host**. Reload settings to confirm persistence. Set the workflow attachment's URL to `https://httpbingo.org/robots.txt` and its ticket to the review ticket. Click **Run**, then **Start Run** in **Run Workflow**. Expect success. Reload the ticket and download the new attachment; its bytes must match the public source. If the public endpoint is unavailable, use a controlled public HTTPS file host and allow its exact hostname.
2. **Revoke download permission.** Remove that custom entry using **Remove** and confirm **Remove host?**. Reload settings, then repeat the same workflow. Expect `VALIDATION_ERROR` naming the unlisted hostname. Reload the ticket: no attachment was added. The automated tests also check that DNS, transport, storage upload and file/document/association inserts never occur.
3. **Contain redirects.** Add `httpbin.dev` as an allowed host; leave `httpbingo.org` unlisted. Run with `https://httpbin.dev/redirect-to?url=https%3A%2F%2Fhttpbingo.org%2Frobots.txt`. Expect `VALIDATION_ERROR` naming the redirect destination and no new ticket attachment after reload. Add `httpbingo.org` and repeat; expect success and downloadable bytes. Automated tests exercise rejection at redirect positions 1, 2 and 3, and a successful three-redirect chain.
4. **Keep tenant policies separate.** In a second isolated tenant, leave `httpbingo.org` unlisted. Repeat the public-file workflow there using that tenant's own ticket. Expect rejection and no attachment. The first tenant's entry must not authorize the second tenant's download. Automated coverage also disables a built-in in one tenant and confirms that another tenant can still use it.
5. **Keep existing files usable.** Run the attachment action using an accessible existing `file_id`, without a URL-host entry. Expect a new ticket association to that file. Reload the ticket and download it; its bytes must match the existing file.

Remove only the review entries you added and restore any entries you removed. Passing review requires downloadable bytes for allowed sources and existing files, and no persisted attachment for either unlisted initial hosts or unlisted redirect destinations in the relevant tenant.

## Automated verification

On November 21, 2026, the shared guard and workflow attachment suites passed **129 tests** (105 guard, 22 native attachment, 2 audio attachment). The existing document-host integration suite passed **12 tests**. The shared package typecheck and production workflow-worker build passed, including runtime and native-storage import validation. DNS and HTTP responses in the workflow suite are injected; the real policy loader, host matcher, redirect guard and upload validation run.

Removing only the workflow's `hostPolicy` argument made all five selected regression cases fail: initial-host rejection, disabled-built-in rejection and rejection at each redirect position. The production source was restored before rerunning the passing suite.

From `server/`:

```sh
npx vitest run src/lib/net/__tests__/safeFetch.test.ts ../shared/workflow/runtime/actions/__tests__/businessOperations.attachDocumentToTicket.native.test.ts ../shared/workflow/runtime/actions/__tests__/businessOperations.attachDocumentToTicket.audio.test.ts --coverage.enabled=false
npx vitest run src/test/integration/documentFetchHosts.integration.test.ts --coverage.enabled=false
```

From the repository root:

```sh
npm run typecheck -w @alga-psa/shared
npm run build:workflow-worker
```
