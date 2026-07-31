# PRD — Brazilian Portuguese (pt-BR) Translation Completion & Correctness

**Status:** Draft / ready for Ralph loop
**Owner:** Natallia Bukhtsik
**Created:** 2026-06-25
**Plan slug:** `2026-06-25-pt-br-translation-completion`

---

## 1. Problem Statement & User Value

Alga PSA ships eight production languages. Seven of them (en, fr, es, de, nl, it, pl)
are ~95% translated in the UI string catalog and fully populated in the email and
internal-notification template systems. **Portuguese (`pt`) is the outlier:**

- UI strings (`server/public/locales/pt/`): **35.9% translated** (8,103 / 22,567 keys);
  the other ~64% still hold the verbatim English string.
- Email templates (`system_email_templates`): **0 pt rows**.
- Internal notification templates (`internal_notification_templates`): **0 pt rows**.
- Because of this, `pt` is the sole entry in `INCOMPLETE_LOCALES` and is hidden from
  every user-facing language picker.

Worse, the existing 36% was produced generically and not validated for **Brazilian**
Portuguese or for **product context**. Domain nouns risk being mistranslated by
register (e.g. a support *ticket* rendered as *bilhete/ingresso* — an event/admission
ticket — instead of *chamado*), and European-Portuguese forms (*comboio*, *telemóvel*,
*ecrã*, *registo*, *utilizador*) may be present where Brazilian forms (*trem*, *celular*,
*tela*, *registro*, *usuário*) are expected.

**User value:** Brazilian MSPs (and their client-portal end users) get a coherent,
correct, dialect-appropriate Portuguese experience across the app UI, the emails they
receive, and the in-app notifications they see — instead of a half-English, register-wrong
patchwork.

## 2. Goals & Non-Goals

### 2.1 Goals
- Make the entire `pt` UI catalog **Brazilian Portuguese**, context-correct, and complete
  (translate the ~14.5k missing keys **and** re-audit the ~8.1k existing keys).
- Establish a **pt-BR domain glossary + dialect ruleset** as the single source of truth for
  terminology, enforced by an audit script the loop runs every iteration.
- Relabel the locale to **"Português (Brasil)"** while keeping the locale code `pt`.
- Populate **pt email templates** (36) and **pt internal-notification templates** (all
  subtypes) — shippable as a **separate PR**.
- Produce a **human-reviewable export** (en→pt side-by-side) for native-speaker sign-off.
- Keep everything green under the existing `validate-translations.cjs` + CI workflow.

### 2.2 Non-Goals
- **Do not auto-enable `pt`.** Per decision, `pt` stays in `INCOMPLETE_LOCALES` pending a
  native speaker's review. Removing it is a documented one-line follow-up, not part of this work.
- **No new locale code.** We are not introducing a distinct `pt-BR` directory — the i18next
  loader uses `load: 'languageOnly'`, which strips region codes, so a `pt-BR` directory would
  not load. (See SCRATCHPAD.)
- No European-Portuguese (`pt-PT`) variant. `pt` content is Brazilian.
- No mobile-app (`ee/mobile`) translation — that catalog is English-only and out of scope.
- No changes to the translation framework, loader, or resolution hierarchy.
- No monitoring/metrics/analytics tooling beyond the audit + validator scripts needed to gate quality.

## 3. Approach

### 3.1 Glossary-first
Author `pt-br-glossary` (a data file under the plan or `.ai/translation/`) before bulk
translation. It maps every recurring domain term to its Brazilian translation, lists
forbidden European-PT forms, and carries an **allowlist** of strings that are legitimately
identical to English (proper nouns, codes, units, "Status", "Dashboard", "Email", etc.) so
the audit doesn't flag them as untranslated. This is the contract that makes "context-relevant"
machine-checkable.

### 3.2 Audit tooling
`scripts/audit-pt-br.cjs` reports, per namespace: (a) keys identical to English minus the
allowlist (= untranslated), (b) glossary/forbidden-term violations, (c) keys not yet marked
reviewed. It emits a per-namespace report the loop consumes to decide what's left. A sidecar
**review-state ledger** makes the full re-audit of already-translated keys resumable across
loop iterations.

### 3.3 Translate + re-audit, namespace by namespace
Per the "Full re-audit" decision, every one of the 22,567 keys is verified — both the ~14.5k
missing (translate) and the ~8.1k existing (verify dialect + context, fix in place). Work is
bucketed into namespace **commit groups** so each commit is a meaningful, bisectable milestone.

### 3.4 Correctness checks (the "museum ticket" guard)
A key is "done" only when: present, not identical to English (unless allowlisted), free of
forbidden-term/glossary violations, with `{{interpolation}}` tokens and CLDR plural forms
(`_one/_few/_many/_other` as Brazilian Portuguese requires) preserved.

## 4. Scope Detail

### 4.1 Locale identity
- Keep code `pt`; keep it in `supportedLocales`.
- `localeNames.pt = 'Português (Brasil)'` in `packages/core/src/lib/i18n/config.ts`.
- `pt` **remains** in `INCOMPLETE_LOCALES` (gated).

### 4.2 UI string catalog (PR 1)
All 45 namespaces under `server/public/locales/pt/` brought to 100% pt-BR + audited.
Heaviest namespaces: `msp/contracts` (1,360), `msp/workflows` (1,706), `msp/clients` (1,150),
`features/projects` (1,342), `features/tickets` (1,214), `msp/assets` (909), `common` (898).
Native-review export generated at the end.

### 4.3 Email + internal-notification templates (PR 2 — separate PR)
- **Email:** 36 templates (auth 5, ticketing 7, invoices 4, credits 1, projects 8,
  appointments 5, time 3, surveys 1). Add `pt` blocks to the **source-of-truth template
  files** in `server/migrations/utils/templates/email/**` (which bake all languages for the
  dev seed) **and** a production migration upserting `language_code='pt'` rows into
  `system_email_templates`, mirroring the Polish reference migration.
- **Internal notifications:** pt rows in `internal_notification_templates` for every subtype,
  via a migration mirroring the Polish notification migration.

### 4.4 Variable / placeholder integrity
Every translated template and string must preserve the exact `{{variable}}` set of its
English source — checked automatically.

### 4.5 Seed/migration parity
The dev seed path and the production migration path must both yield pt rows so fresh DBs and
already-migrated DBs converge.

## 5. Validation / Definition of Done

- `node scripts/validate-translations.cjs` → PASSED (0 errors) including pt.
- `node scripts/audit-pt-br.cjs` → 0 untranslated (minus allowlist) and 0 forbidden-term
  violations across all 45 namespaces.
- Email + notification **parity check**: pt template count == en template count, with matching
  `{{variable}}` sets, for both systems.
- `pt` resolves correctly at runtime (cookie/URL) without English fallback on sampled routes;
  emails/notifications render pt for a pt-resolved recipient.
- Native-review export produced.
- `pt` still gated (not in pickers) — by design.

## 6. Risks, Rollout & Open Questions

### 6.1 Risks
- **Register drift / context errors** (the core risk) — mitigated by glossary + audit, but the
  glossary must be seeded thoroughly; gaps let bad terms through. Human review is the backstop.
- **CLDR plural correctness** — pt-BR uses `_one/_other` (and `_many` for large-number cases);
  the validator already enforces plural-form structure.
- **Email source-of-truth vs migration divergence** — pt must be added in **both** the
  baked template files and a migration, or dev and prod drift.
- **Loop scale** — 22.5k keys is large; the review-state ledger must make progress resumable so
  the loop converges instead of re-doing work.

### 6.2 Rollout
- PR 1 (UI strings) and PR 2 (templates) ship independently; neither makes `pt` user-visible.
- Go-live = a native speaker reviews the export, then a one-line PR removes `pt` from
  `INCOMPLETE_LOCALES`. Out of scope here.

### 6.3 Open questions
- Who is the native-speaker reviewer, and is CSV or markdown preferred for the export? (Export
  supports both; reviewer TBD.)
- Should the glossary live in `.ai/translation/` (alongside existing translation docs) or in the
  plan folder? (Default: `.ai/translation/pt-br-glossary.*` so it's reusable. See SCRATCHPAD.)

## 7. Commit Groups (Ralph loop)

PR 1 — UI strings: `glossary`, `audit-tooling`, `i18n-common`, `i18n-tickets`, `i18n-billing`,
`i18n-projects-time`, `i18n-clients`, `i18n-assets-catalog`, `i18n-admin`, `i18n-workflows`,
`i18n-misc`, `i18n-finalize`.

PR 2 — templates: `email-pt-auth-ticketing`, `email-pt-billing-projects`,
`email-pt-appointments-time-surveys`, `email-pt-migration`, `notif-pt-templates`,
`templates-verify`.

Each group is committed once all its features+tests are `implemented: true`.
