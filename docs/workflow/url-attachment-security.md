# Workflow URL attachment security

The workflow `Add Ticket Attachment` action uses the shared `safeFetch` boundary for URL sources. It retains HTTPS-only requests, public-address validation, DNS connection pinning, manually followed redirects, strict timeouts, streamed byte limits, and IPv6 reserved-range protections.

URL sources must also match the effective download-host policy for the workflow transaction's tenant. The policy comes from `document_fetch_hosts` plus the built-in hosts in `shared/lib/net/fetchHosts.ts` (re-exported by the server document service). Effective entries are enabled built-ins plus tenant custom entries, minus disabled built-ins. Exact and leading `*.` patterns use the shared hostname normalization and matching rules.

The worker loads this policy with the current `tx.tenantId` before calling `safeFetch`. The shared fetch boundary checks the initial hostname before DNS and checks every redirect destination before contacting it. A permitted first host does not permit a redirect to another host unless that destination is also allowed. Empty tenant rows retain the built-in hosts. Malformed patterns do not match; policy lookup errors fail the action before any outbound request. These failures cannot create storage objects, external-file records, document records, or ticket associations.

Tenant administrators manage entries at **Settings → MCP Server → Allowed download hosts**. Add the exact public HTTPS hostname used by the workflow, or a narrowly scoped wildcard when needed. Shared hosting suffixes are refused by the settings validator; do not use broad shared-storage patterns.

Behavioral coverage lives in `shared/workflow/runtime/actions/__tests__/businessOperations.attachDocumentToTicket.native.test.ts` and `server/src/lib/net/__tests__/safeFetch.test.ts`. The first covers tenant selection, initial and redirect allowlist rejection, successful ingestion, redirect chains, malformed/empty policy, and no persistence on rejection. The shared guard suite covers network and redirect protections for all callers.
