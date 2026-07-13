# Lane 7: AI drafting and remaining Community backend gaps

## AI and edition boundary

Drafting follows the existing chat seam at both layers. The real actions live under `ee/server/src/lib/opportunities/` and the edition-selected `@enterprise/*` alias resolves Community builds to denying stubs in `packages/ee/src/lib/opportunities/`. The EE implementation then requires both the AI Assistant add-on and the tenant's effective `experimentalFeatures.aiAssistant` setting. The effective setting already includes the `ai-assistant-activation` feature flag check.

The drafting provider is resolved through the existing `resolveChatProvider` infrastructure. No opportunity code creates an OpenAI, OpenRouter, or Vertex client. Provider selection, secrets, models, and Vertex authentication therefore stay aligned with chat and the other EE AI classifiers.

AI drafting is not tied to the Opportunity Management tier. It is an EE AI capability guarded by the EE alias, the AI Assistant add-on, the tenant toggle, and normal opportunity RBAC.

## Voice profile and draft flow

Voice profiles reuse the tenant-scoped `user_preferences` table under the `opportunity_voice_profile` key. That table already supplies a composite tenant/user/setting key and JSONB values for self-owned preferences, so a second per-user settings table would duplicate an established mechanism. The stored object contains validated `sample_emails` and `steering_instructions`; read, upsert, and delete actions always derive the user id from the authenticated session.

Draft context assembly loads the opportunity and client first, then batches evidence, linked quotes, recent opportunity interactions, and the current user's voice profile. Prompt input is bounded and treats stored deal text as data rather than instructions. The provider must return a JSON object which is parsed into `{ subject, body }`; no provider metadata is returned.

There is no email dependency or send function in drafting. After a human sends through the existing email UI, `logDraftSent` writes an internal opportunity interaction and advances `last_activity_at`.

## Community gaps

Assessment mapping is a UUID array on the existing `opportunity_settings` singleton. Quote acceptance checks selected quote-item service ids against the mapping and records idempotent Assessment evidence with the quote reference before recording Verbal evidence.

The close-won quote option validates that the requested quote is both linked to the opportunity and accepted, then invokes `convertQuoteToDraftContract` inside the existing opportunity transaction and stores the returned contract id. The repository's project-template entry point is an authenticated server action that creates and commits its own transaction; there is no reusable transaction-aware instantiation helper. The REST and action schemas accept `project_template_id`, but the backend rejects its use explicitly instead of risking an orphaned project when a later close step fails.

Handoff data is Community-owned and requires project read permission. The source deal and interaction timeline come from CE tables. Commitments are loaded through an edition-selected provider: CE and non-management tenants return an empty list, while entitled EE tenants read the commitment table.

## Lessons

The lesson library returns structured `WhyFacts` and never edits or bypasses `composeWhy`. Assessment conversion requires five closed deals with active Assessment evidence. Quote velocity requires ten closed deals with a sent quote and usable early and late cohorts. Undefined ratios, including a zero later-cohort close rate, return no lesson rather than inventing a display value. The queue rotates deterministically by local day-of-year when both lessons qualify.

## Verification

Behavioral tests cover thin-history lesson fallbacks and computations, assessment mapping at quote acceptance, accepted linked quote conversion during win preparation, per-user voice-profile persistence, and provider-backed draft context/prompt assembly. Requested package and server typechecks remain the final gate.
