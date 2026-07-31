# Marketing automation recipe (MCP publish loop)

The marketing module publishes **manually by design**: Alga stores no platform
credentials and never calls LinkedIn/X/Meta APIs. When a scheduled post comes
due, its targets flip to `awaiting-manual-publish` and wait for a human — or
for an **MCP-driven agent** — to do the platform part.

This recipe is the agent path. It uses only the constant 3-tool MCP surface
(`search_api_registry`, `search_business_data`, `call_api_endpoint`); there is
no marketing-specific MCP tooling to install.

## 1. One-time setup

1. **Enable the module.** Turn on the `marketing-module` feature flag for the
   tenant (PostHog flag, off by default).
2. **Create an API key** in AlgaPSA → *Settings → API Keys*. The key's user
   must hold `marketing:read` (list queue) and `marketing:manage`
   (mark published / skip). Admin roles have both from the seed migration.
3. **Register the connector** with your MCP client. Claude Desktop example:

   ```json
   {
     "mcpServers": {
       "alga-psa": {
         "command": "npx",
         "args": ["-y", "@alga-psa/mcp-connector"],
         "env": {
           "ALGA_INSTANCE_URL": "https://alga.example.com",
           "ALGA_API_TOKEN": "your-api-key"
         }
       }
     }
   }
   ```

   (EE tenants can instead point a governed agent at the remote MCP server —
   see `docs/mcp-server.md`. Same endpoints, agent identity + audit trail.)

## 2. The publish loop (prompt playbook)

Give the agent a standing instruction along these lines:

> Check Alga for social posts awaiting manual publish. For each one: read the
> rendered text for the target's channel, publish it on that platform yourself
> (browser, platform app, or your own integration), then mark the target
> published in Alga with the resulting permalink. If you cannot publish a
> target, skip it with a note. Report what you published.

The agent's discovery path, end to end:

1. `search_api_registry("social posts awaiting manual publish")`
   → `GET /api/v1/marketing/posts/awaiting-publish`
2. Each queue item carries everything needed: `rendered_text` (the
   channel-variant-resolved post body), channel `platform` + `handle_or_url`,
   the post's `scheduled_at`, and the `target_id`.
3. Publish on the platform **outside Alga** — this is the human/agent step.
4. `call_api_endpoint` → `POST /api/v1/marketing/posts/targets/{targetId}/publish`
   with `{ "permalink": "https://…" }`. Marking is idempotent: a replayed
   call returns the already-published target instead of double-logging.
5. If the post won't go up: `POST /api/v1/marketing/posts/targets/{targetId}/skip`.

Housekeeping is automatic — the `marketing:flip-due-posts` job moves due
scheduled targets to `awaiting-manual-publish` every 5 minutes, and
`marketing:expire-stale-targets` expires anything still waiting after a 48 h
grace so a dead queue can't accumulate silently.

## 3. Other agent-friendly surfaces

| Goal | Endpoint |
|------|----------|
| Plan next week | `GET /api/v1/marketing/posts/queue?date_from=…&date_to=…` |
| Schedule a post | `POST /api/v1/marketing/posts` (`content_id`, `channel_ids[]`, `scheduled_at`) |
| Reschedule | `POST /api/v1/marketing/posts/{id}/reschedule` |
| Campaign funnel | `GET /api/v1/marketing/campaigns/{id}/funnel` |
| Enroll a contact in a nurture sequence | `POST /api/v1/marketing/sequences/{id}/enroll` |

Because discovery goes through `search_api_registry`, agents find these by
plain-language query ("marketing nurture sequence enroll") — no hardcoded
endpoint list required in the prompt.

## 4. What agents can never do

- **Publish inside Alga.** There is deliberately no endpoint that posts to a
  social platform.
- **Read credentials.** The module stores none.
- **Bypass ACLs.** Every marketing endpoint enforces the feature flag and
  `marketing:read`/`marketing:manage`, for API-key and governed-agent callers
  alike.
- **Enumerate suppressions.** The public capture endpoint is rate-limited and
  returns identical responses whether an address is new, known, or
  suppressed.

## 5. Capture forms without an agent

Capture forms are plain public endpoints — embed them anywhere with a small
HTML form posting to:

```
POST {instance}/api/marketing/capture/{tenant}/{slug}
{ "name": "…", "email": "…", "company": "…", "message": "…" }
```

Submissions create (or match) a contact, log a *Form Submitted* engagement,
and — when the form has `creates_suggestion` on — raise an `inbound-lead`
opportunity suggestion for a human to accept in the Opportunities work queue.
