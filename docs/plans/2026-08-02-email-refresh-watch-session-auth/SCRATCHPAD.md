# Scratchpad — Email Refresh Watch Session Authentication

- Plan slug: `email-refresh-watch-session-auth`
- Created: `2026-08-02`

## Decisions

- 2026-08-02: Add the exact refresh-watch route to `apiKeySkipPaths`; retain the existing handler-level `getCurrentUser` authorization and request shape.
- 2026-08-02: Limit regression coverage to the exported `shouldSkipApiKeyAuth` predicate because this is the middleware decision that previously blocked the route.

## Discoveries / Constraints

- 2026-08-02: Edge middleware checks API-key header presence before API route handlers run. Session-authenticated API routes therefore require an explicit skip-path entry.
- 2026-08-02: The provider configuration UI performs a cookie-only `POST` to `/api/email/refresh-watch`.
- 2026-08-02: The refresh route calls `getCurrentUser`; an unauthenticated request is expected to return `{ "error": "Unauthorized" }` with status 401 from the handler.
- 2026-08-02: Audit of direct browser calls under `/api/email/*` found refresh-watch and two IMAP OAuth initiate calls. Both IMAP calls are already covered by `/api/email/oauth/`; refresh-watch was the lone gap.
- 2026-08-02: No database schema or route payload change is needed.

## Commands / Runbooks

- Focused unit test: `cd server && npx vitest run src/test/unit/middleware.apiKeyAuth.test.ts --coverage.enabled=false`
- Server typecheck: run the repository's server typecheck with sufficient Node heap for this workspace.
- Handler-reach smoke: `curl -i -X POST http://127.0.0.1:3213/api/email/refresh-watch -H 'Content-Type: application/json' --data '{"providerId":"test"}'`
- Expected unauthenticated smoke response: status 401 with `{"error":"Unauthorized"}`, not `Unauthorized: API key missing`.

## Links / References

- `server/src/middleware.ts`
- `server/src/test/unit/middleware.apiKeyAuth.test.ts`
- `server/src/app/api/email/refresh-watch/route.ts`
- `packages/integrations/src/components/email/EmailProviderConfiguration.tsx`

## Open Questions

- Authenticated UI smoke requires a configured Google provider and valid external integration credentials.
