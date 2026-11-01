# MCP audit must not persist returned secrets (`handleOne` result summaries)

Card: `fb6e2d12` — security finding **f2** from the review of PR #3991
(merge `3034ea3488`), fingerprint `ee/server/src/lib/mcp/jsonRpcServer.ts#handleOne`,
severity high. Design (Design Session step). Date: 2026-11-01.

## The finding

An authorized agent can call the registered endpoint
`post-_api_v1_webhooks_id_secret_rotate`, which generates and **returns** a
one-time webhook signing secret (`server/src/lib/api/controllers/ApiWebhookController.ts:1355-1379`).
The MCP dispatcher puts the whole response body into the tool outcome
(`ee/server/src/lib/mcp/jsonRpcServer.ts:205`), then hands the serialized text
to `writeAgentAudit` as `resultSummary` (`jsonRpcServer.ts:209`).
`writeAgentAudit` only truncates to 2,000 characters and stores the string
unchanged (`ee/server/src/lib/mcp/agentAudit.ts:16-30`), and
`GET /api/v1/mcp/audit` returns those rows to a tenant Admin
(`server/src/app/api/v1/mcp/audit/route.ts:12-28`).

So the "one-time" secret survives the rotation: it is readable for as long as
the audit row exists, by anyone with the audit export, and it never expires.
Confirmed in code at the two fingerprints; the defect predates PR #3991.

## Design decision

Returning the secret to the agent **is** the endpoint's contract — the agent is
the principal rotating the credential and must receive it. The defect is that
the *audit* is a lossy copy of an arbitrary response body: it inherits every
secret any endpoint will ever return, and it is retained and exported.

Two rules follow:

1. **The audit boundary owns secrecy, not the call sites.** Sanitization moves
   into `writeAgentAudit` (the one place every audit row passes through), so a
   future endpoint that returns a secret is covered without touching the
   dispatcher.
2. **Represent the outcome structurally.** `resultSummary` becomes a redacted,
   re-serialized summary (status, ok, decision, and a redacted body) rather than
   the raw text. Truncation stays, but truncation is never the safety property.

This reuses the walk that already exists for arguments rather than inventing a
second scheme: `packages/agent-tooling/src/invoke/redactToolArguments.ts`
already implements a recursive redactor driven by (a) a sensitive-key set and
(b) shape heuristics (credential-prefixed strings, signed URLs, oversized
base64). That walk is the mechanism; today it is only applied to the input side.

## Changes

1. **Lift the walk to a shared, bidirectional redactor** in
   `packages/agent-tooling/src/invoke/redactToolArguments.ts`
   (exported through the package index alongside the existing function):
   - extend the always-sensitive set with `signing_secret`, `client_secret`,
     `secret`, `password`, `private_key`, `api_key`, `webhook_secret`;
   - add a key-shape rule: any key ending in `_secret`, `_password`, or `_token`
     is redacted (documented as deliberately broad — a redacted pagination token
     costs a developer one debug session, a stored signing secret costs a
     credential);
   - keep the carrier handling (`body`, `data`, `payload`, `arguments`) so a
     JSON-encoded body is redacted through its serialization layers.
2. **Add `redactToolResult(tool: string, text: string | undefined)`** in the
   same module:
   - parse the text as JSON when possible, walk it, re-serialize;
   - when it is not JSON, apply the string sweep (`redactValue(text)`), so a
     plain-text body still loses credential-prefixed strings and signed URLs;
   - cap at `MAX_SUMMARY` after redaction (never before — truncation must not be
     able to hide a secret by cutting a container in half).
   Leave room for per-tool overrides via a small map (`TOOL_RESULT_REDACTORS`)
   where a tool's summary should be narrower than its body; no entries are needed
   today, and the map is populated only when a tool's summary needs a field that
   the generic walk would keep.
3. **Wire it in `writeAgentAudit`** (`ee/server/src/lib/mcp/agentAudit.ts`):
   `result_summary: redactToolResult(entry.tool, entry.resultSummary)` and the
   same walk over `entry.arguments` (defence in depth; the dispatcher may keep
   its existing pre-redaction). This is the single guarantee: no future caller
   can write an unredacted summary.
4. **Do not** redact the tool *response* — the agent must receive the secret.
   This is a storage/export fix, not an API change; changelog entry only.
5. **Remediate existing rows.** A one-off, idempotent script (documented in the
   migration notes, run by the operator) sets `result_summary = null` — or a
   redacted summary retaining `status`/`ok` — for rows whose `tool` is
   `call_api_endpoint` and whose `result_summary` matches a secret-bearing shape
   (`signing_secret`, `secret`, `_token` keys). Without this the fix only stops
   new leaks.

## Tests

- Unit (`packages/agent-tooling/src/invoke/__tests__/redactToolResult.test.ts`):
  - a `call_api_endpoint` result whose data carries `signing_secret` → secret
    absent from the summary, `status`/`ok` preserved;
  - nested body: `{ data: { webhook: { signing_secret } } }` and a
    JSON-string-inside-a-string body → redacted at depth;
  - unparsable plain-text body containing `Bearer xyz` → redacted;
  - a benign result (`{ status: 200, ok: true, data: { ticket_id } }`) is
    unchanged — the fix must not make the audit useless;
  - existing `redactToolArguments` cases still pass (the walk is shared).
- Integration: exercise `tools/call` for the secret-rotate endpoint with an
  agent token, then read `mcp_agent_audit` and `GET /api/v1/mcp/audit` — the
  secret value appears in neither, while the tool response still contains it.

## Non-goals

- Rotating already-leaked secrets: the rotated value is in an existing audit
  row, and the card cannot know which tenants ran it. The remediation script
  removes the row content; the tenant can rotate again. Noting this in the
  release note is the honest scope.
- Reworking `mcp_agent_audit` into per-tool columns. The redacted summary is
  enough for the audit's purpose (what the agent did, whether it succeeded).

## Risks

- Over-redaction making the audit uninformative. Mitigated by keeping `status`,
  `ok`, `decision`, and non-secret fields; tests pin a benign result unchanged.
- The key-suffix rule catching a field a support engineer needs. Bounded: the
  summary keeps every non-secret key; the unredacted value is still visible to
  the agent in the response.
